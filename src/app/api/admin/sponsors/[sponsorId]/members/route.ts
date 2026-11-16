import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  isValidUuid,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ sponsorId: string }>;
}

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

async function requireSponsorAdmin(request: Request) {
  const { user, isAdmin, error, mfaRequired } = await getAdminSessionFromRequest(request);
  if (!user) return { response: respond(request, { error: 'Authentication required.' }, 401) };
  if (error) {
    console.error('Unable to verify sponsor-member management access:', error.message);
    return { response: respond(request, { error: 'Unable to verify administrator access.' }, 500) };
  }
  if (mfaRequired) {
    return { response: respond(request, { error: 'Complete administrator MFA before managing sponsor accounts.' }, 403) };
  }
  if (!isAdmin) return { response: respond(request, { error: 'Forbidden' }, 403) };
  const rateLimit = await checkApiRateLimit({
    scope: 'admin:sponsors:members:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return {
      response: respond(
        request,
        { error: rateLimit.unavailable ? 'Sponsor account management is temporarily unavailable.' : 'Too many sponsor account changes. Please wait.' },
        rateLimit.unavailable ? 503 : 429,
        rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
      ),
    };
  }
  return { user };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const access = await requireSponsorAdmin(request);
  if (access.response) return access.response;
  const { sponsorId } = await params;
  if (!isValidUuid(sponsorId)) return respond(request, { error: 'Invalid sponsor id.' }, 400);

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid sponsor account details.' }, 400);

  const email = parsed.value.email;
  const role = parsed.value.role;
  if (
    typeof email !== 'string' ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof role !== 'string' ||
    !['owner', 'manager', 'analyst'].includes(role)
  ) {
    return respond(request, { error: 'Enter a valid account email and sponsor role.' }, 400);
  }

  try {
    const adminClient = createServiceRoleClient();
    const targetEmail = email.trim().toLowerCase();
    let targetUserId: string | null = null;
    const pageSize = 1000;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: pageSize });
      if (error) {
        console.error('Unable to search Auth users for sponsor assignment:', error.message);
        return respond(request, { error: 'Unable to look up the account. Try again later.' }, 503);
      }
      const match = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail);
      if (match) {
        targetUserId = match.id;
        break;
      }
      if (data.users.length < pageSize) break;
    }

    if (!targetUserId) {
      return respond(
        request,
        { error: 'No CathoScroll account exists with that email. The person must create an account before you can grant sponsor access.' },
        404
      );
    }

    const { data, error } = await adminClient.rpc('admin_add_sponsor_member', {
      p_actor_user_id: access.user.id,
      p_sponsor_id: sponsorId,
      p_user_id: targetUserId,
      p_role: role,
    });
    if (error) {
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === '22023') return respond(request, { error: 'The sponsor or user account could not be found.' }, 404);
      console.error('Unable to assign sponsor account:', error.message);
      return respond(request, { error: 'Unable to grant sponsor access.' }, 500);
    }
    return respond(request, { membership: data }, 201);
  } catch (cause) {
    console.error('Sponsor account assignment failed:', cause);
    return respond(request, { error: 'Sponsor account management is temporarily unavailable.' }, 503);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const access = await requireSponsorAdmin(request);
  if (access.response) return access.response;
  const { sponsorId } = await params;
  if (!isValidUuid(sponsorId)) return respond(request, { error: 'Invalid sponsor id.' }, 400);

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value) || !isValidUuid(parsed.value.membershipId) ||
      typeof parsed.value.action !== 'string' ||
      !['suspend', 'reactivate', 'revoke'].includes(parsed.value.action)) {
    return respond(request, { error: 'Invalid sponsor membership update.' }, 400);
  }

  try {
    const adminClient = createServiceRoleClient();
    const { data: existingMembership, error: lookupError } = await adminClient
      .from('sponsor_memberships')
      .select('id')
      .eq('id', parsed.value.membershipId)
      .eq('sponsor_id', sponsorId)
      .maybeSingle();
    if (lookupError) {
      console.error('Unable to verify sponsor membership ownership:', lookupError.message);
      return respond(request, { error: 'Unable to verify sponsor membership.' }, 503);
    }
    if (!existingMembership) return respond(request, { error: 'Sponsor membership not found.' }, 404);

    const { data: membership, error } = await adminClient.rpc('admin_set_sponsor_member_status', {
      p_actor_user_id: access.user.id,
      p_membership_id: parsed.value.membershipId,
      p_action: parsed.value.action,
    });
    if (error) {
      if (error.code === 'P0002') return respond(request, { error: 'Sponsor membership not found.' }, 404);
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === '22023') return respond(request, { error: 'Invalid sponsor membership action.' }, 400);
      console.error('Unable to update sponsor membership:', error.message);
      return respond(request, { error: 'Unable to update sponsor access.' }, 500);
    }
    return respond(request, { membership });
  } catch (cause) {
    console.error('Sponsor membership update failed:', cause);
    return respond(request, { error: 'Sponsor account management is temporarily unavailable.' }, 503);
  }
}
