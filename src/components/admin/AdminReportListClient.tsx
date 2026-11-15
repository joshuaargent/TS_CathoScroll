'use client';

import { useRouter } from 'next/navigation';
import { AdminReportList } from './AdminReportList';
import type { AdminCommentReport } from '@/lib/moderation/types';

export function AdminReportListClient({
  reports,
  adminUserId,
}: {
  reports: AdminCommentReport[];
  adminUserId: string;
}) {
  const router = useRouter();
  return (
    <AdminReportList
      reports={reports}
      adminUserId={adminUserId}
      onChange={() => router.refresh()}
    />
  );
}
