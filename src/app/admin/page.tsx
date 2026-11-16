import Link from 'next/link';

import { AdminAppealList } from '@/components/admin/AdminAppealList';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { AdminReportListClient } from '@/components/admin/AdminReportListClient';
import { loadCommentBanAppeals, loadCommentReports } from '@/lib/moderation/admin-data';
import { requireAdminPage } from '@/lib/moderation/require-admin';

export default async function AdminPage() {
  const { adminClient, user } = await requireAdminPage();
  const [{ items: reports }, { items: appeals }, { data: isOwner, error: ownerError }] = await Promise.all([
    loadCommentReports(adminClient, 0, 10),
    loadCommentBanAppeals(adminClient, 0, 10),
    adminClient.rpc('is_cathoscroll_admin_owner', { p_user_id: user.id }),
  ]);
  if (ownerError) {
    console.error('Unable to verify owner-only dashboard links:', ownerError.message);
  }
  const ownerCanViewAudit = isOwner === true;


  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Moderation</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Admin dashboard</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Review private reports and comment-ban appeals. Admin actions are recorded for
          accountability.
        </p>
      </div>

      <div className="mt-8">
        <AdminNavigation />
      </div>
      {ownerCanViewAudit && (
        <div className="mt-4">
          <Link href="/admin/audit" className="text-accent text-sm font-semibold hover:underline">
            View administrator audit log
          </Link>
        </div>
      )}

      <section className="mb-14">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Latest comment reports</h2>
            <p className="text-text-muted mt-1 text-sm">
              Reporter identities are visible only here.
            </p>
          </div>
          <Link href="/admin/reports" className="text-accent text-sm font-medium hover:underline">
            View all reports
          </Link>
        </div>
        <AdminReportListClient reports={reports} adminUserId={user.id} />
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Latest comment-ban appeals</h2>
            <p className="text-text-muted mt-1 text-sm">
              Review the user’s full comment and reply history before deciding.
            </p>
          </div>
          <Link href="/admin/appeals" className="text-accent text-sm font-medium hover:underline">
            View all appeals
          </Link>
        </div>
        <AdminAppealList appeals={appeals} />
      </section>
    </main>
  );
}
