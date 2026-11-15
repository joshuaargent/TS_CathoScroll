import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSessionFromRequest, isSameOriginOrNativeRequest, nativeApiCorsHeaders, isValidUuid } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return respond(request, body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, { status: 403 });
  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);

  if (!user) {
    return respond(request, { error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify comment-history access:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;

  if (!isValidUuid(userId)) {
    return respond(request, { error: 'Invalid user id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const offsetParam = Number(url.searchParams.get('offset') ?? '0');
  const limitParam = Number(url.searchParams.get('limit') ?? '30');

  if (
    !Number.isSafeInteger(offsetParam) ||
    offsetParam < 0 ||
    !Number.isSafeInteger(limitParam) ||
    limitParam < 1 ||
    limitParam > 100
  ) {
    return respond(request, { error: 'Invalid pagination values' }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment history is not configured:', error);
    return respond(request, { error: 'Comment history is not configured' }, { status: 500 });
  }

  const { data: comments, error: commentsError } = await adminClient
    .from('comments')
    .select('id,user_id,topic_id,parent_id,content,created_at,edited_at,is_deleted')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offsetParam, offsetParam + limitParam);

  if (commentsError) {
    console.error('Unable to load user comment history:', commentsError.message);
    return respond(request, { error: 'Unable to load comment history' }, { status: 500 });
  }

  const parentIds = [
    ...new Set((comments ?? []).map((comment) => comment.parent_id).filter(Boolean)),
  ];
  const { data: parents, error: parentsError } = parentIds.length
    ? await adminClient.from('comments').select('id,user_id,content,is_deleted').in('id', parentIds)
    : { data: [], error: null };

  if (parentsError) {
    console.error('Unable to load reply context:', parentsError.message);
    return respond(request, { error: 'Unable to load comment history' }, { status: 500 });
  }

  const profileIds = [...new Set([userId, ...(parents ?? []).map((parent) => parent.user_id)])];
  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id,username,display_name')
    .in('id', profileIds);

  if (profilesError) {
    console.error('Unable to load comment-history profiles:', profilesError.message);
    return respond(request, { error: 'Unable to load comment history' }, { status: 500 });
  }

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const parentById = new Map((parents ?? []).map((parent) => [parent.id, parent]));
  const page = comments ?? [];
  const topicIds = [...new Set(page.map((comment) => comment.topic_id))];
  const { data: topicRows, error: topicsError } = topicIds.length
    ? await adminClient.from('topics').select('id,question').in('id', topicIds)
    : { data: [], error: null };

  if (topicsError) {
    console.error('Unable to load comment-history topic names:', topicsError.message);
    return respond(request, { error: 'Unable to load comment history' }, { status: 500 });
  }

  const topicTitleById = new Map((topicRows ?? []).map((topic) => [topic.id, topic.question]));

  return respond(request, {
    comments: page.map((comment) => {
      const parent =
        comment.parent_id === null ? null : (parentById.get(comment.parent_id) ?? null);

      return {
        ...comment,
        profile: profileById.get(comment.user_id) ?? null,
        topicTitle: topicTitleById.get(comment.topic_id) ?? 'Unknown topic',
        parent: parent
          ? {
              content: parent.is_deleted ? '[Deleted comment]' : parent.content,
              profile: profileById.get(parent.user_id) ?? null,
            }
          : null,
      };
    }),
    nextOffset: page.length > limitParam ? offsetParam + limitParam : null,
  });
}
