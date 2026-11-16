import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSessionFromRequest, isSameOriginOrNativeRequest, nativeApiCorsHeaders } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);

  if (!user) {
    return respond(request, { error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify report moderator:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:moderation',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Administrator services are temporarily unavailable' : 'Too many administrator requests. Please wait.' },
      { status: rateLimit.unavailable ? 503 : 429, headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds) }
    );
  }

  const { reportId: reportIdParam } = await params;

  if (!/^[1-9]\d*$/.test(reportIdParam) || !Number.isSafeInteger(Number(reportIdParam))) {
    return respond(request, { error: 'Invalid report id' }, { status: 400 });
  }

  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('action' in body) ||
    !['dismiss', 'resolve', 'hide'].includes(String(body.action)) ||
    !('note' in body) ||
    (body.note !== null && typeof body.note !== 'string') ||
    (typeof body.note === 'string' && body.note.length > 1000)
  ) {
    return respond(request, { error: 'Invalid moderation action' }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Report moderation is not configured:', error);
    return respond(request, { error: 'Report moderation is not configured' }, { status: 500 });
  }

  // Review status, audit details, and any requested comment hide are handled
  // atomically by the database function.
  const { data: status, error: reviewError } = await adminClient.rpc(
    'admin_review_comment_report',
    {
      target_report_id: Number(reportIdParam),
      review_action: body.action,
      reviewer_user_id: user.id,
      review_note: typeof body.note === 'string' ? body.note.trim() || null : null,
    }
  );

  if (reviewError) {
    if (reviewError.code === 'P0002') {
      return respond(request, { error: 'Report not found' }, { status: 404 });
    }

    if (reviewError.code === '23505') {
      return respond(request, { error: 'This report has already been reviewed' }, { status: 409 });
    }

    console.error('Unable to update comment report:', reviewError.message);
    return respond(request, { error: 'Unable to update report' }, { status: 500 });
  }

  return respond(request, { status });
}
