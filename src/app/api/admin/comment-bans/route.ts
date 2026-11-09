import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSession,
  isSameOrigin,
  isValidUuid,
} from '@/lib/supabase/admin';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSession();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify comment moderator:', roleError.message);
    return NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    !['ban', 'unban'].includes(String(body.action)) ||
    !('userId' in body) ||
    !isValidUuid(body.userId) ||
    !('reason' in body) ||
    typeof body.reason !== 'string' ||
    body.reason.trim().length < 5 ||
    body.reason.length > 1000 ||
    ('hideExistingComments' in body && typeof body.hideExistingComments !== 'boolean') ||
    ('restoreHiddenComments' in body && typeof body.restoreHiddenComments !== 'boolean')
  ) {
    return NextResponse.json({ error: 'Invalid comment restriction details' }, { status: 400 });
  }

  if (body.action === 'ban' && body.userId === user.id) {
    return NextResponse.json({ error: 'You cannot restrict your own account' }, { status: 400 });
  }

  const hideExistingComments = 'hideExistingComments' in body && body.hideExistingComments === true;
  const restoreHiddenComments =
    'restoreHiddenComments' in body && body.restoreHiddenComments === true;

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment restrictions are not configured:', error);
    return NextResponse.json({ error: 'Comment restrictions are not configured' }, { status: 500 });
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', body.userId)
    .maybeSingle();

  if (targetError) {
    console.error('Unable to verify comment restriction target:', targetError.message);
    return NextResponse.json({ error: 'Unable to update comment restriction' }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { data, error: moderationError } = await adminClient.rpc('admin_manage_comment_ban', {
    target_user_id: body.userId,
    moderator_user_id: user.id,
    moderation_action: body.action,
    moderation_reason: body.reason.trim(),
    hide_existing_comments: hideExistingComments,
    restore_hidden_comments: restoreHiddenComments,
  });

  if (moderationError) {
    if (moderationError.code === '23505') {
      return NextResponse.json(
        { error: 'This user already has an active comment restriction' },
        { status: 409 }
      );
    }

    if (moderationError.code === 'P0002') {
      return NextResponse.json(
        { error: 'This user has no active comment restriction' },
        { status: 404 }
      );
    }

    console.error('Unable to update comment restriction:', moderationError.message);
    return NextResponse.json({ error: 'Unable to update comment restriction' }, { status: 500 });
  }

  return NextResponse.json(data, { status: body.action === 'ban' ? 201 : 200 });
}
