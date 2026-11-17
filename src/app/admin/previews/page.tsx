import { FeedCardPreview } from '@/components/admin/FeedCardPreview';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { requireAdminPage } from '@/lib/moderation/require-admin';

export default async function AdminFeedPreviewsPage() {
  const { user } = await requireAdminPage('/admin/previews');

  return (
    <main className="container py-12">
      <p className="text-accent text-sm font-semibold tracking-wider uppercase">Moderation tools</p>
      <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Feed card previews</h1>
      <p className="text-text-secondary mt-4 max-w-3xl">
        Review the real feed card components with isolated sample content. No production
        comments, sponsor campaigns, engagement counts, or analytics are changed.
      </p>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <FeedCardPreview userId={user.id} />
    </main>
  );
}
