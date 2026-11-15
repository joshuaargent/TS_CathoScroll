import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

const reportReasons = ['harassment', 'hate_speech', 'spam', 'inappropriate', 'other'] as const;

function respond(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: nativeApiCorsHeaders(request) });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }

  let authenticated;
  try {
    authenticated = await getAuthenticatedUserFromRequest(request);
  } catch (error) {
    console.error('Unable to verify comment report identity:', error);
    return respond(request, { error: 'Unable to verify your account' }, 500);
  }
  const { user } = authenticated;
  if (!user) {
    return respond(request, { error: 'Sign in to report a comment' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(request, { error: 'Invalid JSON body' }, 400);
  }

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

  const details = 'details' in body && typeof body.details === 'string' ? body.details : null;

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment reporting is not configured:', error);
    return respond(request, { error: 'Comment reporting is not configured' }, 500);
  }

  // Keep duplicate-report and rate-limit checks inside the database transaction.
  const { error: insertError } = await adminClient.rpc('submit_comment_report', {
    reporter_user_id: user.id,
    target_comment_id: body.commentId,
    report_reason: body.reason,
    report_details: details?.trim() || null,
  });

  if (insertError) {
    if (insertError.code === 'P0002') {
      return respond(request, { error: 'Comment not found' }, 404);
    }
    if (insertError.code === '22023') {
      return respond(request, { error: 'You cannot report your own comment' }, 400);
    }
    if (insertError.code === 'P0001') {
      return respond(request, { error: 'You have reached the limit of 10 reports in 24 hours' }, 429);
    }
    if (insertError.code === '23505') {
      return respond(request, { error: 'You already have an open report for this comment' }, 409);
    }
    console.error('Unable to submit comment report:', insertError.message);
    return respond(request, { error: 'Unable to submit report' }, 500);
  }

  return respond(request, { submitted: true }, 201);
}
