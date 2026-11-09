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
    body.reason.length > 1000
  ) {
    return NextResponse.json({ error: 'Invalid comment restriction details' }, { status: 400 });
  }

  if (body.action === 'ban' && body.userId === user.id) {
    return NextResponse.json({ error: 'You cannot restrict your own account' }, { status: 400 });
  }

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

  if (body.action === 'ban') {
    const { error: insertError } = await adminClient.from('user_comment_bans').insert({
      user_id: body.userId,
      banned_by: user.id,
      reason: body.reason.trim(),
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'This user is already restricted from commenting' },
          { status: 409 }
        );
      }

      console.error('Unable to apply comment restriction:', insertError.message);
      return NextResponse.json({ error: 'Unable to apply comment restriction' }, { status: 500 });
    }

    return NextResponse.json({ banned: true }, { status: 201 });
  }

  const { data: activeBan, error: banError } = await adminClient
    .from('user_comment_bans')
    .select('id')
    .eq('user_id', body.userId)
    .is('unbanned_at', null)
    .maybeSingle();

  if (banError) {
    console.error('Unable to load comment restriction:', banError.message);
    return NextResponse.json({ error: 'Unable to remove comment restriction' }, { status: 500 });
  }

  if (!activeBan) {
    return NextResponse.json(
      { error: 'This user has no active comment restriction' },
      { status: 404 }
    );
  }

  const { error: updateError } = await adminClient
    .from('user_comment_bans')
    .update({
      unbanned_at: new Date().toISOString(),
      unbanned_by: user.id,
      unban_reason: body.reason.trim(),
    })
    .eq('id', activeBan.id);

  if (updateError) {
    console.error('Unable to remove comment restriction:', updateError.message);
    return NextResponse.json({ error: 'Unable to remove comment restriction' }, { status: 500 });
  }

  return NextResponse.json({ banned: false });
}
