import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, getTrustedClientIp, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

const reportReasons = ['harassment', 'hate_speech', 'spam', 'inappropriate', 'other'] as const;

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);

  let authenticated: Awaited<ReturnType<typeof getAuthenticatedUserFromRequest>>;
  try {
    authenticated = await getAuthenticatedUserFromRequest(request);
  } catch (error) {
    console.error('Unable to verify comment report identity:', error);
    return respond(request, { error: 'Unable to verify your account' }, 500);
  }
  const { user } = authenticated;
  if (!user) return respond(request, { error: 'Sign in to report a comment' }, 401);

  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  const body = parsed.value;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('commentId' in body) ||
    typeof body.commentId !== 'number' ||
    !Number.isSafeInteger(body.commentId) ||
    body.commentId < 1 ||
    !('reason' in body) ||
    typeof body.reason !== 'string' ||
    !reportReasons.includes(body.reason as (typeof reportReasons)[number]) ||
    ('details' in body &&
      ((body.details !== null && typeof body.details !== 'string') ||
        (typeof body.details === 'string' && body.details.length > 1000)))
  ) {
    return respond(request, { error: 'Invalid report details' }, 400);
  }

  const userRateLimit = await checkApiRateLimit({
    scope: 'comment-report:user',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!userRateLimit.allowed) {
    return respond(
      request,
      { error: userRateLimit.unavailable ? 'Reporting is temporarily unavailable' : 'You are reporting too quickly. Please wait.' },
      userRateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(userRateLimit.retryAfterSeconds)
    );
  }

  const clientIp = getTrustedClientIp(request);
  if (process.env.VERCEL === '1' && !clientIp) {
    return respond(request, { error: 'Reporting is temporarily unavailable' }, 503);
  }
  if (clientIp) {
    const ipRateLimit = await checkApiRateLimit({
      scope: 'comment-report:ip',
      identifier: clientIp,
      limit: 30,
      windowSeconds: 60,
    });
    if (!ipRateLimit.allowed) {
      return respond(
        request,
        { error: ipRateLimit.unavailable ? 'Reporting is temporarily unavailable' : 'Too many reports from this network. Please wait.' },
        ipRateLimit.unavailable ? 503 : 429,
        rateLimitResponseHeaders(ipRateLimit.retryAfterSeconds)
      );
    }
  }

  const details = 'details' in body && typeof body.details === 'string' ? body.details : null;

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment reporting is not configured:', error);
    return respond(request, { error: 'Comment reporting is not configured' }, 500);
  }

  const { error: insertError } = await adminClient.rpc('submit_comment_report', {
    reporter_user_id: user.id,
    target_comment_id: body.commentId,
    report_reason: body.reason,
    report_details: details?.trim() || null,
  });

  if (insertError) {
    if (insertError.code === 'P0002') return respond(request, { error: 'Comment not found' }, 404);
    if (insertError.code === '22023') return respond(request, { error: 'You cannot report your own comment' }, 400);
    if (insertError.code === 'P0001') return respond(request, { error: 'You have reached the limit of 10 reports in 24 hours' }, 429);
    if (insertError.code === '23505') return respond(request, { error: 'You already have an open report for this comment' }, 409);
    console.error('Unable to submit comment report:', insertError.message);
    return respond(request, { error: 'Unable to submit report' }, 500);
  }

  return respond(request, { submitted: true }, 201);
}
