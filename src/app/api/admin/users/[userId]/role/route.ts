import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
  isValidUuid,
} from '@/lib/supabase/admin';

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, { status: 401 });
  if (roleError) {
    console.error('Unable to verify admin role-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, { status: 403 });

  const { userId } = await params;
  if (!isValidUuid(userId)) return respond(request, { error: 'Invalid user id' }, { status: 400 });

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Admin role management is not configured:', error);
    return respond(request, { error: 'Admin role management is not configured' }, { status: 500 });
  }

  const [profileResult, banResult, adminResult] = await Promise.all([
    adminClient.from('profiles').select('id').eq('id', userId).maybeSingle(),
    adminClient
      .from('user_comment_bans')
      .select('reason')
      .eq('user_id', userId)
      .is('unbanned_at', null)
      .maybeSingle(),
    adminClient.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle(),
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
    isAdmin: true,
    canManage: user.id !== userId,
    activeBan: banResult.data,
    profileIsAdmin: Boolean(adminResult.data),
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);
  if (!user) {
    return respond(request, { error: 'Authentication required' }, { status: 401 });
  }
  if (roleError) {
    console.error('Unable to verify admin role-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, { status: 500 });
  }
  if (!isAdmin) {
    return respond(request, { error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  if (!isValidUuid(userId)) {
    return respond(request, { error: 'Invalid user id' }, { status: 400 });
  }
  if (userId === user.id) {
    return respond(request, 
      { error: 'You cannot grant admin access to yourself.' },
      { status: 400 }
    );
  }

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Admin role management is not configured:', error);
    return respond(request, { error: 'Admin role management is not configured' }, { status: 500 });
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Unable to verify admin role target:', profileError.message);
    return respond(request, { error: 'Unable to verify target account.' }, { status: 500 });
  }
  if (!profile) {
    return respond(request, { error: 'User profile not found.' }, { status: 404 });
  }

  const { error: insertError } = await adminClient.from('admin_users').insert({ user_id: userId });
  if (insertError && insertError.code !== '23505') {
    console.error('Unable to grant admin access:', insertError.message);
    return respond(request, { error: 'Unable to grant admin access.' }, { status: 500 });
  }

  return respond(request, { success: true, isAdmin: true });
}
