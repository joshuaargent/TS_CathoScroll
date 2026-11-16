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
  headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }

  const { user, isAdmin, error: roleError, mfaRequired } =
    await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (roleError) {
    console.error('Unable to verify sponsor-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify administrator access' }, 500);
  }
  if (mfaRequired) {
    return respond(request, { error: 'Complete administrator MFA before managing sponsors.' }, 403);
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:sponsors:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Sponsor management is temporarily unavailable.' : 'Too many sponsor changes. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const { sponsorId } = await params;
  if (!isValidUuid(sponsorId)) return respond(request, { error: 'Invalid sponsor id.' }, 400);

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    !('action' in parsed.value) ||
    parsed.value.action !== 'mark_payment_received' ||
    !('paymentReference' in parsed.value) ||
    (parsed.value.paymentReference !== null && typeof parsed.value.paymentReference !== 'string') ||
    (typeof parsed.value.paymentReference === 'string' && parsed.value.paymentReference.trim().length > 120)
  ) {
    return respond(request, { error: 'Invalid sponsor payment update.' }, 400);
  }

  try {
    const adminClient = createServiceRoleClient();
    const { data, error } = await adminClient.rpc('admin_mark_sponsor_payment_received', {
      p_actor_user_id: user.id,
      p_sponsor_id: sponsorId,
      p_payment_reference:
        typeof parsed.value.paymentReference === 'string'
          ? parsed.value.paymentReference.trim() || null
          : null,
    });

    if (error) {
      if (error.code === 'P0002') return respond(request, { error: 'Sponsor not found.' }, 404);
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === '23514') return respond(request, { error: 'Only pending bank transfers can be marked received.' }, 409);
      console.error('Unable to update sponsor payment:', error.message);
      return respond(request, { error: 'Unable to update sponsor payment.' }, 500);
    }

    return respond(request, { sponsor: data });
  } catch (cause) {
    console.error('Sponsor payment update failed:', cause);
    return respond(request, { error: 'Sponsor management is temporarily unavailable.' }, 500);
  }
}
