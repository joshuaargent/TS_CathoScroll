import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';

interface RouteContext {
  params: Promise<{
    commentId: string;
  }>;
}

function respond(request: Request, body: unknown, status = 200) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }

  const { commentId: commentIdParam } = await params;
  if (!/^[1-9]\d*$/.test(commentIdParam)) {
    return respond(request, { error: 'Invalid comment id' }, 400);
  }
  const commentId = Number(commentIdParam);
  if (!Number.isSafeInteger(commentId)) {
    return respond(request, { error: 'Invalid comment id' }, 400);
  }

  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  const body = parsed.value;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('pinned' in body) ||
    typeof body.pinned !== 'boolean'
  ) {
    return respond(request, { error: 'Expected a boolean pinned value' }, 400);
  }

  const { user, isAdmin, error: adminCheckError } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (adminCheckError) {
    console.error('Unable to verify comment moderation role:', adminCheckError.message);
    return respond(request, { error: 'Unable to verify admin access' }, 500);
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment pinning is not configured:', error);
    return respond(request, { error: 'Comment pinning is not configured' }, 500);
  }

  // The RPC serializes pin changes per topic and enforces the single pinned
  // top-level-comment rule even when admins act concurrently.
  const { error } = await adminClient.rpc('admin_set_comment_pin', {
    target_comment_id: commentId,
    should_pin: body.pinned,
  });
  if (error) {
    if (error.code === 'P0002') {
      return respond(request, { error: 'Top-level comment not found' }, 404);
    }
    console.error('Unable to update pinned comment:', error.message);
    return respond(request, { error: 'Unable to update pinned comment' }, 500);
  }

  return respond(request, { pinned: body.pinned });
}
