import { NextResponse } from 'next/server';

import { getAuthenticatedUser, isSameOrigin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const countOnly = new URL(request.url).searchParams.get('countOnly') === '1';
  // Keep the bell request cheap: it asks Postgres for an exact unread count
  // without returning notification rows. The page request loads only the
  // newest 50 rows; both queries are scoped by the user's RLS-protected id.
  const { count, error: countError } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (countError) {
    console.error('Unable to load unread notification count:', countError.message);
    return NextResponse.json({ error: 'Unable to load notifications' }, { status: 500 });
  }

  if (countOnly) {
    return NextResponse.json({ unreadCount: count ?? 0 });
  }

  const { data: notifications, error: notificationsError } = await supabase
    .from('notifications')
    .select('id,type,title,body,topic_id,comment_id,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (notificationsError) {
    console.error('Unable to load notifications:', notificationsError.message);
    return NextResponse.json({ error: 'Unable to load notifications' }, { status: 500 });
  }

  return NextResponse.json({
    notifications: notifications ?? [],
    unreadCount: count ?? 0,
  });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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
    !['read', 'read_all'].includes(String(body.action)) ||
    (body.action === 'read' &&
      (!('notificationId' in body) ||
        typeof body.notificationId !== 'number' ||
        !Number.isSafeInteger(body.notificationId) ||
        body.notificationId < 1))
  ) {
    return NextResponse.json({ error: 'Invalid notification update' }, { status: 400 });
  }

  const targetNotificationId =
    'notificationId' in body && typeof body.notificationId === 'number'
      ? body.notificationId
      : null;

  let updateQuery = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (body.action === 'read' && targetNotificationId !== null) {
    updateQuery = updateQuery.eq('id', targetNotificationId);
  }

  const { data, error } = await updateQuery.select('id');

  if (error) {
    console.error('Unable to mark notifications as read:', error.message);
    return NextResponse.json({ error: 'Unable to update notifications' }, { status: 500 });
  }

  if (body.action === 'read' && targetNotificationId !== null && (!data || data.length === 0)) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }

  return NextResponse.json({ updated: data?.length ?? 0 });
}
