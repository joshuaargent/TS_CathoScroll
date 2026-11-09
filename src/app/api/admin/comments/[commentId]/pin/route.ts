import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSession, isSameOrigin } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{
    commentId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { commentId: commentIdParam } = await params;

  if (!/^[1-9]\d*$/.test(commentIdParam)) {
    return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });
  }

  const commentId = Number(commentIdParam);

  if (!Number.isSafeInteger(commentId)) {
    return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });
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
    !('pinned' in body) ||
    typeof body.pinned !== 'boolean'
  ) {
    return NextResponse.json({ error: 'Expected a boolean pinned value' }, { status: 400 });
  }

  const { user, isAdmin, error: adminCheckError } = await getAdminSession();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (adminCheckError) {
    console.error('Unable to verify comment moderation role:', adminCheckError.message);
    return NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment pinning is not configured:', error);
    return NextResponse.json({ error: 'Comment pinning is not configured' }, { status: 500 });
  }

  // The RPC serializes pin changes per topic and enforces the single pinned
  // top-level-comment rule even when admins act concurrently.
  const { error } = await adminClient.rpc('admin_set_comment_pin', {
    target_comment_id: commentId,
    should_pin: body.pinned,
  });

  if (error) {
    if (error.code === 'P0002') {
      return NextResponse.json({ error: 'Top-level comment not found' }, { status: 404 });
    }

    console.error('Unable to update pinned comment:', error.message);
    return NextResponse.json({ error: 'Unable to update pinned comment' }, { status: 500 });
  }

  return NextResponse.json({ pinned: body.pinned });
}
