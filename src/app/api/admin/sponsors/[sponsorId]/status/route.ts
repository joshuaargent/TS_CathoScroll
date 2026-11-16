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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const { user, isAdmin, error, mfaRequired } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required.' }, 401);
  if (error) return respond(request, { error: 'Unable to verify administrator access.' }, 500);
  if (mfaRequired) return respond(request, { error: 'Complete administrator MFA before changing sponsor status.' }, 403);
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const limit = await checkApiRateLimit({
    scope: 'admin:sponsors:status:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return respond(
      request,
      { error: limit.unavailable ? 'Sponsor management is temporarily unavailable.' : 'Too many sponsor changes. Please wait.' },
      limit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(limit.retryAfterSeconds)
    );
  }

  const { sponsorId } = await params;
  if (!isValidUuid(sponsorId)) return respond(request, { error: 'Invalid sponsor id.' }, 400);
  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value) || typeof parsed.value.status !== 'string' ||
      !['draft', 'scheduled', 'active', 'paused', 'completed'].includes(parsed.value.status)) {
    return respond(request, { error: 'Invalid sponsor status.' }, 400);
  }

  try {
    const client = createServiceRoleClient();
    const { data, error: rpcError } = await client.rpc('admin_set_sponsor_status', {
      p_actor_user_id: user.id,
      p_sponsor_id: sponsorId,
      p_status: parsed.value.status,
    });
    if (rpcError) {
      if (rpcError.code === 'P0002') return respond(request, { error: 'Sponsor not found.' }, 404);
      if (rpcError.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (rpcError.code === '22023') return respond(request, { error: 'Invalid sponsor status.' }, 400);
      console.error('Unable to change sponsor status:', rpcError.message);
      return respond(request, { error: 'Unable to update sponsor status.' }, 500);
    }
    return respond(request, { sponsor: data });
  } catch (cause) {
    console.error('Sponsor status update failed:', cause);
    return respond(request, { error: 'Sponsor management is temporarily unavailable.' }, 503);
  }
}
