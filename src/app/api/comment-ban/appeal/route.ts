import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAuthenticatedUser, isSameOrigin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { user } = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: 'Sign in to request a review' }, { status: 401 });
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
    !('message' in body) ||
    typeof body.message !== 'string'
  ) {
    return NextResponse.json({ error: 'Enter a message for your appeal' }, { status: 400 });
  }

  const message = body.message.trim();

  if (message.length < 20 || message.length > 2000) {
    return NextResponse.json(
      { error: 'Appeals must be between 20 and 2,000 characters' },
      { status: 400 }
    );
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment-ban appeals are not configured:', error);
    return NextResponse.json({ error: 'Appeals are not configured' }, { status: 500 });
  }

  const { data: activeBan, error: banError } = await adminClient
    .from('user_comment_bans')
    .select('id')
    .eq('user_id', user.id)
    .is('unbanned_at', null)
    .maybeSingle();

  if (banError) {
    console.error('Unable to check comment ban:', banError.message);
    return NextResponse.json({ error: 'Unable to submit appeal' }, { status: 500 });
  }

  if (!activeBan) {
    return NextResponse.json(
      { error: 'There is no active comment restriction to appeal' },
      { status: 409 }
    );
  }

  const { error: insertError } = await adminClient.from('comment_ban_appeals').insert({
    user_id: user.id,
    ban_id: activeBan.id,
    message,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'You already have an appeal waiting for review' },
        { status: 409 }
      );
    }

    console.error('Unable to save comment-ban appeal:', insertError.message);
    return NextResponse.json({ error: 'Unable to submit appeal' }, { status: 500 });
  }

  return NextResponse.json({ submitted: true }, { status: 201 });
}
