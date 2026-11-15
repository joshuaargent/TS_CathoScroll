import { NextResponse } from 'next/server';

import { getAuthenticatedUser, isSameOrigin } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';

function respond(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return respond({ error: 'Authentication required' }, { status: 401 });
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
    return respond({ error: 'Unable to load notifications' }, { status: 500 });
  }

  if (countOnly) {
    return respond({ unreadCount: count ?? 0 });
  }

  const { data: notificationRows, error: notificationsError } = await supabase
    .from('notifications')
    .select('id,type,title,body,topic_id,comment_id,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (notificationsError) {
    console.error('Unable to load notifications:', notificationsError.message);
    return respond({ error: 'Unable to load notifications' }, { status: 500 });
  }

  const topicIds = [
    ...new Set(
      (notificationRows ?? []).map((notification) => notification.topic_id).filter(Boolean)
    ),
  ];
  const { data: topics, error: topicsError } = topicIds.length
    ? await supabase.from('topics').select('id,slug').in('id', topicIds)
    : { data: [], error: null };

  if (topicsError) {
    console.error('Unable to resolve notification topic links:', topicsError.message);
    return respond({ error: 'Unable to load notifications' }, { status: 500 });
  }

  const topicSlugById = new Map((topics ?? []).map((topic) => [String(topic.id), topic.slug]));

  return respond({
    notifications: (notificationRows ?? []).map((notification) => ({
      ...notification,
      topic_slug: notification.topic_id ? (topicSlugById.get(notification.topic_id) ?? null) : null,
    })),
    unreadCount: count ?? 0,
  });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return respond({ error: 'Forbidden' }, { status: 403 });
  }

  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return respond({ error: 'Authentication required' }, { status: 401 });
  }

  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) return respond({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

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
    return respond({ error: 'Invalid notification update' }, { status: 400 });
  }

  const targetNotificationId =
    'notificationId' in body && typeof body.notificationId === 'number'
      ? body.notificationId
      : null;

  // Restrict writes to the authenticated user's unread rows. The database RLS
  // policy repeats this ownership check and clients only have read_at UPDATE
  // permission, so the endpoint cannot alter notification content or ownership.
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
    return respond({ error: 'Unable to update notifications' }, { status: 500 });
  }

  if (body.action === 'read' && targetNotificationId !== null && (!data || data.length === 0)) {
    return respond({ error: 'Notification not found' }, { status: 404 });
  }

  return respond({ updated: data?.length ?? 0 });
}
