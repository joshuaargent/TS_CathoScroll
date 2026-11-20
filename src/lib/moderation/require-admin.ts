import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { createServiceRoleClient, getAdminSession } from '@/lib/supabase/admin';

export async function requireAdminPage(nextPath = '/admin') {
  const safeNextPath =
    nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.includes('\\')
      ? nextPath
      : '/admin';
  const { user, isAdmin, error } = await getAdminSession();

  if (!user) {
    redirect(`/signin?next=${encodeURIComponent(safeNextPath)}`);
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
