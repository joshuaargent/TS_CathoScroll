import { AdminContentManager } from '@/components/admin/AdminContentManager';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { requireAdminPage } from '@/lib/moderation/require-admin';

const pageSize = 500;

async function loadAllRows<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
) {
  const rows: T[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query(offset, offset + pageSize - 1);
    if (error) {
      console.error(`Unable to load admin ${label}:`, error.message);
      throw new Error(`Unable to load ${label}.`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export default async function AdminContentPage() {
  const { adminClient } = await requireAdminPage();
  const [categories, topics] = await Promise.all([
    loadAllRows(
      (from, to) =>
        adminClient
          .from('categories')
          .select('slug,name,description,order_index,is_published')
          .order('order_index', { ascending: true })
          .order('slug', { ascending: true })
          .range(from, to),
      'categories'
    ),
    loadAllRows(
      (from, to) =>
        adminClient
          .from('topics')
          .select(
            'id,slug,category_slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,is_published'
          )
          .order('order_index', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'topics'
    ),
  ]);

  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Content library</h1>
        <p className="text-text-secondary mt-3 max-w-3xl">
          Create, edit, organise, publish, and archive categories and learning topics. Changes are
          saved to Supabase and invalidate the shared public content cache.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <AdminContentManager categories={categories} topics={topics} />
    </main>
  );
}
