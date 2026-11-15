'use client';

import { useRouter } from 'next/navigation';
import {
  AdminReportList,
  type AdminCommentReport,
} from './AdminReportList';

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
