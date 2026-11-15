import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
  isValidUuid,
} from '@/lib/supabase/admin';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

async function authorize(request: Request, mutation: boolean) {
  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);
  if (!user) return { response: respond(request, { error: 'Authentication required' }, { status: 401 }) };
  if (roleError) {
    console.error('Unable to verify admin role-management access:', roleError.message);
    return { response: respond(request, { error: 'Unable to verify admin access' }, { status: 500 }) };
  }
  if (!isAdmin) return { response: respond(request, { error: 'Forbidden' }, { status: 403 }) };

  const rateLimit = await checkApiRateLimit({
    scope: mutation ? 'admin:role:write' : 'admin:role:read',
    identifier: user.id,
    limit: mutation ? 10 : 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return {
      response: respond(
        request,
        { error: rateLimit.unavailable ? 'Administrator services are temporarily unavailable' : 'Too many administrator requests. Please wait.' },
        {
          status: rateLimit.unavailable ? 503 : 429,
          headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
        }
      ),
    };
  }

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Admin role management is not configured:', error);
    return { response: respond(request, { error: 'Admin role management is not configured' }, { status: 500 }) };
  }

  const { data: owner, error: ownerError } = await adminClient.rpc('is_cathoscroll_admin_owner', {
    p_user_id: user.id,
  });
  if (ownerError) {
    console.error('Unable to verify administrator owner:', ownerError.message);
    return { response: respond(request, { error: 'Unable to verify administrator permissions' }, { status: 500 }) };
  }

  return { user, adminClient, isOwner: owner === true };
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { userId } = await params;
  if (!isValidUuid(userId)) return respond(request, { error: 'Invalid user id' }, { status: 400 });

  const auth = await authorize(request, false);
  if ('response' in auth) return auth.response;

  const [profileResult, banResult, adminResult] = await Promise.all([
    auth.adminClient.from('profiles').select('id').eq('id', userId).maybeSingle(),
    auth.adminClient.from('user_comment_bans').select('reason').eq('user_id', userId).is('unbanned_at', null).maybeSingle(),
    auth.adminClient.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileResult.error || banResult.error || adminResult.error) {
    console.error('Unable to load profile moderation details:', {
      profile: profileResult.error?.message,
      ban: banResult.error?.message,
      admin: adminResult.error?.message,
    });
    return respond(request, { error: 'Unable to load moderation details.' }, { status: 500 });
  }
  if (!profileResult.data) return respond(request, { error: 'User profile not found.' }, { status: 404 });

  return respond(request, {
    isAdmin: Boolean(adminResult.data),
    canManage: auth.isOwner && auth.user.id !== userId,
    activeBan: banResult.data,
    profileIsAdmin: Boolean(adminResult.data),
  });
}

async function updateRole(request: Request, userId: string, grant: boolean) {
  if (!isValidUuid(userId)) return respond(request, { error: 'Invalid user id' }, { status: 400 });
  const auth = await authorize(request, true);
  if ('response' in auth) return auth.response;
  if (!auth.isOwner) return respond(request, { error: 'Only the CathoScroll owner can manage administrator access.' }, { status: 403 });
  if (userId === auth.user.id) return respond(request, { error: 'You cannot change your own administrator access.' }, { status: 400 });

  const { data, error } = await auth.adminClient.rpc('admin_set_user_role', {
    p_target_user_id: userId,
    p_actor_user_id: auth.user.id,
    p_grant: grant,
  });
  if (error) {
    if (error.code === 'P0002') return respond(request, { error: 'User account not found.' }, { status: 404 });
    if (error.code === '42501') return respond(request, { error: 'Only the CathoScroll owner can manage administrator access.' }, { status: 403 });
    if (error.code === '23514') return respond(request, { error: 'This account must set up and verify an authenticator before receiving administrator access. Ask them to visit Account → Security.' }, { status: 409 });
    console.error('Unable to change administrator role:', error.message);
    return respond(request, { error: 'Unable to change administrator access.' }, { status: 500 });
  }
  return respond(request, { success: true, isAdmin: grant, changed: data?.changed === 1 });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { userId } = await params;
  return updateRole(request, userId, true);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { userId } = await params;
  return updateRole(request, userId, false);
}
