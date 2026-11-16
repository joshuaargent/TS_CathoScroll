import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
  isValidUuid,
} from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

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

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);

  if (!user) {
    return respond(request, { error: 'Authentication required' }, { status: 401 });
  }

  if (roleError) {
    console.error('Unable to verify comment moderator:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }

  if (!isAdmin) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:moderation',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Administrator services are temporarily unavailable' : 'Too many administrator requests. Please wait.' },
      { status: rateLimit.unavailable ? 503 : 429, headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds) }
    );
  }

  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

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
    return respond(request, { error: 'Invalid comment restriction details' }, { status: 400 });
  }

  if (body.action === 'ban' && body.userId === user.id) {
    return respond(request, { error: 'You cannot restrict your own account' }, { status: 400 });
  }

  const hideExistingComments = 'hideExistingComments' in body && body.hideExistingComments === true;
  const restoreHiddenComments =
    'restoreHiddenComments' in body && body.restoreHiddenComments === true;

  let adminClient;

  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Comment restrictions are not configured:', error);
    return respond(request, { error: 'Comment restrictions are not configured' }, { status: 500 });
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', body.userId)
    .maybeSingle();

  if (targetError) {
    console.error('Unable to verify comment restriction target:', targetError.message);
    return respond(request, { error: 'Unable to update comment restriction' }, { status: 500 });
  }

  if (!target) {
    return respond(request, { error: 'User not found' }, { status: 404 });
  }

  // Ban state and optional comment hiding/restoration are one transaction in
  // the database function, so they cannot partially succeed.
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
      return respond(request, 
        { error: 'This user already has an active comment restriction' },
        { status: 409 }
      );
    }

    if (moderationError.code === 'P0002') {
      return respond(request, 
        { error: 'This user has no active comment restriction' },
        { status: 404 }
      );
    }

    console.error('Unable to update comment restriction:', moderationError.message);
    return respond(request, { error: 'Unable to update comment restriction' }, { status: 500 });
  }

  return respond(request, data, { status: body.action === 'ban' ? 201 : 200 });
}
