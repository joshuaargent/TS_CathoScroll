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

  const { data: comment, error: commentError } = await adminClient
    .from('comments')
    .select('id,user_id,is_deleted')
    .eq('id', body.commentId)
    .maybeSingle();

  if (commentError) {
    console.error('Unable to verify reported comment:', commentError.message);
    return NextResponse.json({ error: 'Unable to submit report' }, { status: 500 });
  }

  if (!comment || comment.is_deleted) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  if (comment.user_id === user.id) {
    return NextResponse.json({ error: 'You cannot report your own comment' }, { status: 400 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await adminClient
    .from('comment_reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', user.id)
    .gte('created_at', since);

  if (countError) {
    console.error('Unable to check report limit:', countError.message);
    return NextResponse.json({ error: 'Unable to submit report' }, { status: 500 });
  }

  if ((count ?? 0) >= 10) {
    return NextResponse.json(
      { error: 'You have reached the limit of 10 reports in 24 hours' },
      { status: 429 }
    );
  }

  const { error: insertError } = await adminClient.from('comment_reports').insert({
    reporter_id: user.id,
    comment_id: body.commentId,
    reason: body.reason,
    details: details?.trim() || null,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'You already have an open report for this comment' },
        { status: 409 }
      );
    }

    console.error('Unable to save comment report:', insertError.message);
    return NextResponse.json({ error: 'Unable to submit report' }, { status: 500 });
  }

  return NextResponse.json({ submitted: true }, { status: 201 });
}
