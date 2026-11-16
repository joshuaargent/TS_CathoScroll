import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { user, isAdmin, error, mfaRequired } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (error) {
    console.error('Unable to verify audit-log access:', error.message);
    return respond(request, { error: 'Unable to verify administrator access' }, 500);
  }
  if (mfaRequired) return respond(request, { error: 'Complete administrator MFA at /account/security.' }, 403);
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:audit:read',
    identifier: user.id,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Audit log is temporarily unavailable' : 'Too many audit-log requests. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const beforeValue = new URL(request.url).searchParams.get('before');
  const beforeId = beforeValue === null ? null : Number(beforeValue);
  if (beforeValue !== null && (!/^[1-9]\d*$/.test(beforeValue) || !Number.isSafeInteger(beforeId))) {
    return respond(request, { error: 'Invalid audit cursor' }, 400);
  }

  try {
    const adminClient = createServiceRoleClient();
    const { data: isOwner, error: ownerError } = await adminClient.rpc(
      'is_cathoscroll_admin_owner',
      { p_user_id: user.id }
    );
    if (ownerError) throw ownerError;
    if (isOwner !== true) return respond(request, { error: 'Owner permission required' }, 403);

    const { data, error: auditError } = await adminClient.rpc('admin_get_action_audit', {
      p_actor_user_id: user.id,
      p_before_id: beforeId,
      p_limit: 50,
    });
    if (auditError) throw auditError;
    return respond(request, { entries: data ?? [] });
  } catch (cause) {
    console.error('Unable to load administrator audit log:', cause);
    return respond(request, { error: 'Unable to load audit log.' }, 500);
  }
}
