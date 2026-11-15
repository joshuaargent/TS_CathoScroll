import { NextResponse } from 'next/server';

import {
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { ...init, headers });
}

async function enforceUserLimit(userId: string, scope: string, limit: number) {
  return checkApiRateLimit({
    scope,
    identifier: userId,
    limit,
    windowSeconds: 60,
  });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedUserFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, { status: 401 });

  const rateLimit = await enforceUserLimit(user.id, 'notifications:read', 60);
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Notifications are temporarily unavailable' : 'Too many notification requests. Please wait.' },
      {
        status: rateLimit.unavailable ? 503 : 429,
        headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      }
    );
  }

  const countOnly = new URL(request.url).searchParams.get('countOnly') === '1';
  const { count, error: countError } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (countError) {
    console.error('Unable to load unread notification count:', countError.message);
    return respond(request, { error: 'Unable to load notifications' }, { status: 500 });
  }
  if (countOnly) return respond(request, { unreadCount: count ?? 0 });

  const { data: notificationRows, error: notificationsError } = await supabase
    .from('notifications')
    .select('id,type,title,body,topic_id,comment_id,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (notificationsError) {
    console.error('Unable to load notifications:', notificationsError.message);
    return respond(request, { error: 'Unable to load notifications' }, { status: 500 });
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
    return respond(request, { error: 'Unable to load notifications' }, { status: 500 });
  }

  const topicSlugById = new Map((topics ?? []).map((topic) => [String(topic.id), topic.slug]));
  return respond(request, {
    notifications: (notificationRows ?? []).map((notification) => ({
      ...notification,
      topic_slug: notification.topic_id ? (topicSlugById.get(notification.topic_id) ?? null) : null,
    })),
    unreadCount: count ?? 0,
  });
}

export async function PATCH(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { supabase, user } = await getAuthenticatedUserFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, { status: 401 });

  const rateLimit = await enforceUserLimit(user.id, 'notifications:write', 30);
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Notifications are temporarily unavailable' : 'Too many notification updates. Please wait.' },
      {
        status: rateLimit.unavailable ? 503 : 429,
        headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      }
    );
  }

  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) {
    return respond(request, { error: parsed.error }, { status: parsed.status });
  }
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
    return respond(request, { error: 'Invalid notification update' }, { status: 400 });
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
    return respond(request, { error: 'Unable to update notifications' }, { status: 500 });
  }

  if (body.action === 'read' && targetNotificationId !== null && (!data || data.length === 0)) {
    return respond(request, { error: 'Notification not found' }, { status: 404 });
  }

  return respond(request, { updated: data?.length ?? 0 });
}
