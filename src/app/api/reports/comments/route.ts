import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAuthenticatedUser, isSameOrigin } from '@/lib/supabase/admin';

const reportReasons = ['harassment', 'hate_speech', 'spam', 'inappropriate', 'other'] as const;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { user } = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: 'Sign in to report a comment' }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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
    return NextResponse.json({ error: 'Invalid report details' }, { status: 400 });
  }

  const details = 'details' in body && typeof body.details === 'string' ? body.details : null;

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment reporting is not configured:', error);
    return NextResponse.json({ error: 'Comment reporting is not configured' }, { status: 500 });
  }

  const { error: insertError } = await adminClient.rpc('submit_comment_report', {
    reporter_user_id: user.id,
    target_comment_id: body.commentId,
    report_reason: body.reason,
    report_details: details?.trim() || null,
  });

  if (insertError) {
    if (insertError.code === 'P0002') {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (insertError.code === '22023') {
      return NextResponse.json({ error: 'You cannot report your own comment' }, { status: 400 });
    }

    if (insertError.code === 'P0001') {
      return NextResponse.json(
        { error: 'You have reached the limit of 10 reports in 24 hours' },
        { status: 429 }
      );
    }

    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'You already have an open report for this comment' },
        { status: 409 }
      );
    }

    console.error('Unable to submit comment report:', insertError.message);
    return NextResponse.json({ error: 'Unable to submit report' }, { status: 500 });
  }

  return NextResponse.json({ submitted: true }, { status: 201 });
}
