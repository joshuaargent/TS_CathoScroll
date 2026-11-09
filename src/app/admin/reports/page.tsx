import Link from 'next/link';

import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { AdminReportList } from '@/components/admin/AdminReportList';
import { loadCommentReports } from '@/lib/moderation/admin-data';
import { requireAdminPage } from '@/lib/moderation/require-admin';

interface Props {
  searchParams: Promise<{ page?: string }>;
}

const pageSize = 25;

export default async function AdminReportsPage({ searchParams }: Props) {
  const { adminClient, user } = await requireAdminPage();
  const { page: pageParam } = await searchParams;
  const requestedPage = Number(pageParam ?? '0');
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
  const { items, hasNext } = await loadCommentReports(adminClient, page * pageSize, pageSize);

  return (
    <main className="container py-12">
      <div className="mt-8">
        <h1 className="text-4xl font-extrabold md:text-5xl">Comment reports</h1>
        <p className="text-text-secondary mt-3">
          Reports are private to admins. Newest reports appear first.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <AdminReportList reports={items} adminUserId={user.id} />
      <div className="mt-8 flex justify-between">
        {page > 0 ? (
          <Link
            href={`/admin/reports?page=${page - 1}`}
            className="border-border rounded-lg border px-4 py-2 text-sm"
          >
            Newer reports
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link
            href={`/admin/reports?page=${page + 1}`}
            className="border-border rounded-lg border px-4 py-2 text-sm"
          >
            Older reports
          </Link>
        )}
      </div>
    </main>
  );
}
