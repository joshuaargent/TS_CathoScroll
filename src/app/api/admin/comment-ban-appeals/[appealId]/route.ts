import { NextResponse } from 'next/server';

import { createServiceRoleClient, getAdminSessionFromRequest, isSameOriginOrNativeRequest, nativeApiCorsHeaders } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';

interface RouteContext {
  params: Promise<{ appealId: string }>;
}

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);

  if (!user) {
    return respond(request, { error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify appeal moderator:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { appealId: appealIdParam } = await params;

  if (!/^[1-9]\d*$/.test(appealIdParam) || !Number.isSafeInteger(Number(appealIdParam))) {
    return respond(request, { error: 'Invalid appeal id' }, { status: 400 });
  }

  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

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
    return respond(request, { error: 'Invalid appeal decision' }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Appeal review is not configured:', error);
    return respond(request, { error: 'Appeal review is not configured' }, { status: 500 });
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
      return respond(request, { error: 'Appeal not found' }, { status: 404 });
    }

    if (reviewError.code === '23505') {
      return respond(request, { error: 'This appeal has already been reviewed' }, { status: 409 });
    }

    console.error('Unable to review comment-ban appeal:', reviewError.message);
    return respond(request, { error: 'Unable to review appeal' }, { status: 500 });
  }

  return respond(request, { status });
}
