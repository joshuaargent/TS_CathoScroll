import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSession, isSameOrigin } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSession();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify report moderator:', roleError.message);
    return NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { reportId: reportIdParam } = await params;

  if (!/^[1-9]\d*$/.test(reportIdParam) || !Number.isSafeInteger(Number(reportIdParam))) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
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
    !('action' in body) ||
    !['dismiss', 'resolve', 'hide'].includes(String(body.action)) ||
    !('note' in body) ||
    (body.note !== null && typeof body.note !== 'string') ||
    (typeof body.note === 'string' && body.note.length > 1000)
  ) {
    return NextResponse.json({ error: 'Invalid moderation action' }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Report moderation is not configured:', error);
    return NextResponse.json({ error: 'Report moderation is not configured' }, { status: 500 });
  }

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
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (reviewError.code === '23505') {
      return NextResponse.json({ error: 'This report has already been reviewed' }, { status: 409 });
    }

    console.error('Unable to update comment report:', reviewError.message);
    return NextResponse.json({ error: 'Unable to update report' }, { status: 500 });
  }

  return NextResponse.json({ status });
}
