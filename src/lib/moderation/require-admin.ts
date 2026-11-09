import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { createServiceRoleClient, getAdminSession } from '@/lib/supabase/admin';

export async function requireAdminPage() {
  const { user, isAdmin, error } = await getAdminSession();

  if (!user) {
    redirect('/signin?next=%2Fadmin');
  }

  if (error) {
    console.error('Unable to verify admin page access:', error.message);
    throw new Error('Unable to verify admin access.');
  }

  if (!isAdmin) {
    notFound();
  }

  return {
    user,
    adminClient: createServiceRoleClient(),
  };
}
