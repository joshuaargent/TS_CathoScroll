import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSession, isSameOrigin } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ appealId: string }>;
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
    console.error('Unable to verify appeal moderator:', roleError.message);
    return NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { appealId: appealIdParam } = await params;

  if (!/^[1-9]\d*$/.test(appealIdParam) || !Number.isSafeInteger(Number(appealIdParam))) {
    return NextResponse.json({ error: 'Invalid appeal id' }, { status: 400 });
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
    !('decision' in body) ||
    !['approve', 'dismiss'].includes(String(body.decision)) ||
    !('note' in body) ||
    (body.note !== null && typeof body.note !== 'string') ||
    (typeof body.note === 'string' && body.note.length > 1000) ||
    ('restoreHiddenComments' in body && typeof body.restoreHiddenComments !== 'boolean')
  ) {
    return NextResponse.json({ error: 'Invalid appeal decision' }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Appeal review is not configured:', error);
    return NextResponse.json({ error: 'Appeal review is not configured' }, { status: 500 });
  }

  const restoreHiddenComments =
    'restoreHiddenComments' in body && body.restoreHiddenComments === true;

  // Appeal decision, restriction change, and optional restoration must commit
  // together; the database function provides that transaction boundary.
  const { data: status, error: reviewError } = await adminClient.rpc(
    'admin_review_comment_ban_appeal',
    {
      target_appeal_id: Number(appealIdParam),
      approve_appeal: body.decision === 'approve',
      reviewer_user_id: user.id,
      review_note: typeof body.note === 'string' ? body.note.trim() || null : null,
      restore_hidden_comments: restoreHiddenComments,
    }
  );

  if (reviewError) {
    if (reviewError.code === 'P0002') {
      return NextResponse.json({ error: 'Appeal not found' }, { status: 404 });
    }

    if (reviewError.code === '23505') {
      return NextResponse.json({ error: 'This appeal has already been reviewed' }, { status: 409 });
    }

    console.error('Unable to review comment-ban appeal:', reviewError.message);
    return NextResponse.json({ error: 'Unable to review appeal' }, { status: 500 });
  }

  return NextResponse.json({ status });
}
