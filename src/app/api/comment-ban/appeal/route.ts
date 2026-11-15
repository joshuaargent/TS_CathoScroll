import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

function respond(request: Request, body: unknown, status = 200) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { status, headers });
}

async function authenticate(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return { response: respond(request, { error: 'Forbidden' }, 403) };
  }

  try {
    const { user } = await getAuthenticatedUserFromRequest(request);
    if (!user) {
      return { response: respond(request, { error: 'Sign in to request a review' }, 401) };
    }
    return { user };
  } catch (error) {
    console.error('Unable to authenticate comment-ban appeal request:', error);
    return { response: respond(request, { error: 'Unable to verify your account' }, 500) };
  }
}

function serviceClient() {
  try {
    return createServiceRoleClient();
  } catch (error) {
    console.error('Comment-ban appeals are not configured:', error);
    return null;
  }
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ('response' in auth) return auth.response;

  const adminClient = serviceClient();
  if (!adminClient) return respond(request, { error: 'Appeals are not configured' }, 500);

  const [{ data: ban, error: banError }, { data: appeal, error: appealError }] =
    await Promise.all([
      adminClient
        .from('user_comment_bans')
        .select('id,created_at')
        .eq('user_id', auth.user.id)
        .is('unbanned_at', null)
        .maybeSingle(),
      adminClient
        .from('comment_ban_appeals')
        .select('id,status,created_at')
        .eq('user_id', auth.user.id)
        .eq('status', 'pending')
        .maybeSingle(),
    ]);

  if (banError || appealError) {
    console.error(
      'Unable to load comment-ban appeal details:',
      banError?.message,
      appealError?.message
    );
    return respond(request, { error: 'Unable to load your appeal details' }, 500);
  }

  return respond(request, { ban: ban ?? null, appeal: appeal ?? null });
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(request, { error: 'Invalid JSON body' }, 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('message' in body) ||
    typeof body.message !== 'string'
  ) {
    return respond(request, { error: 'Enter a message for your appeal' }, 400);
  }

  const message = body.message.trim();
  if (message.length < 20 || message.length > 2000) {
    return respond(request, { error: 'Appeals must be between 20 and 2,000 characters' }, 400);
  }

  const adminClient = serviceClient(request);
  if (!adminClient) return respond(request, { error: 'Appeals are not configured' }, 500);

  const { data: activeBan, error: banError } = await adminClient
    .from('user_comment_bans')
    .select('id')
    .eq('user_id', auth.user.id)
    .is('unbanned_at', null)
    .maybeSingle();

  if (banError) {
    console.error('Unable to check comment ban:', banError.message);
    return respond(request, { error: 'Unable to submit appeal' }, 500);
  }

  if (!activeBan) {
    return respond(request, { error: 'There is no active comment restriction to appeal' }, 409);
  }

  const { error: insertError } = await adminClient.from('comment_ban_appeals').insert({
    user_id: auth.user.id,
    ban_id: activeBan.id,
    message,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return respond(request, { error: 'You already have an appeal waiting for review' }, 409);
    }
    console.error('Unable to save comment-ban appeal:', insertError.message);
    return respond(request, { error: 'Unable to submit appeal' }, 500);
  }

  return respond(request, { submitted: true }, 201);
}
