import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAdminSession,
  isSameOrigin,
  isValidUuid,
} from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { user, isAdmin, error: roleError } = await getAdminSession();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (roleError) {
    console.error('Unable to verify admin role-management access:', roleError.message);
    return NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  if (!isValidUuid(userId)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json(
      { error: 'You cannot grant admin access to yourself.' },
      { status: 400 }
    );
  }

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Admin role management is not configured:', error);
    return NextResponse.json({ error: 'Admin role management is not configured' }, { status: 500 });
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Unable to verify admin role target:', profileError.message);
    return NextResponse.json({ error: 'Unable to verify target account.' }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
  }

  const { error: insertError } = await adminClient.from('admin_users').insert({ user_id: userId });
  if (insertError && insertError.code !== '23505') {
    console.error('Unable to grant admin access:', insertError.message);
    return NextResponse.json({ error: 'Unable to grant admin access.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, isAdmin: true });
}
