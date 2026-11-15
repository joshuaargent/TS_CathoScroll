'use client';

import { useRouter } from 'next/navigation';
import { AdminRoleControl } from './AdminRoleControl';

export function AdminRoleControlClient({
  userId,
  isAdmin,
  canManage,
}: {
  userId: string;
  isAdmin: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  return (
    <AdminRoleControl
      userId={userId}
      isAdmin={isAdmin}
      canManage={canManage}
      onChange={() => router.refresh()}
    />
  );
}
