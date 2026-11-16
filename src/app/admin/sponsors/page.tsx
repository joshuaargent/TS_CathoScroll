import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { SponsorManager, type SponsorRecord } from '@/components/admin/SponsorManager';
import { requireAdminPage } from '@/lib/moderation/require-admin';

export const metadata = {
  title: 'Sponsor management',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminSponsorsPage() {
  const { adminClient } = await requireAdminPage('/admin/sponsors');
  const { data, error } = await adminClient
    .from('sponsors')
    .select(
      'id,sponsor_name,contact_email,website_url,logo_url,description,starts_on,ends_on,status,agreed_amount_minor,currency,payment_status,payment_received_at,payment_reference,admin_notes,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Unable to load sponsor records:', error.message);
    throw new Error('Unable to load sponsor management.');
  }

  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Sponsor management</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Create sponsor records, record the agreed amount and manually reconcile bank-transfer
          payments. Sponsor records are private and are not displayed to learners yet.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <SponsorManager sponsors={(data ?? []) as SponsorRecord[]} />
    </main>
  );
}
