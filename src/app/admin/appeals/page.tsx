import Link from 'next/link';

import { AdminAppealList } from '@/components/admin/AdminAppealList';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { loadCommentBanAppeals } from '@/lib/moderation/admin-data';
import { requireAdminPage } from '@/lib/moderation/require-admin';

interface Props {
  searchParams: Promise<{ page?: string }>;
}

const pageSize = 25;

export default async function AdminAppealsPage({ searchParams }: Props) {
  const { adminClient } = await requireAdminPage();
  const { page: pageParam } = await searchParams;
  const requestedPage = Number(pageParam ?? '0');
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
  const { items, hasNext } = await loadCommentBanAppeals(adminClient, page * pageSize, pageSize);

  return (
    <main className="container py-12">
      <div className="mt-8">
        <h1 className="text-4xl font-extrabold md:text-5xl">Comment-ban appeals</h1>
        <p className="text-text-secondary mt-3">
          Review a user’s appeal and inspect their complete comment history, including reply
          context.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <AdminAppealList appeals={items} />
      <div className="mt-8 flex justify-between">
        {page > 0 ? (
          <Link
            href={`/admin/appeals?page=${page - 1}`}
            className="border-border rounded-lg border px-4 py-2 text-sm"
          >
            Newer appeals
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link
            href={`/admin/appeals?page=${page + 1}`}
            className="border-border rounded-lg border px-4 py-2 text-sm"
          >
            Older appeals
          </Link>
        )}
      </div>
    </main>
  );
}
