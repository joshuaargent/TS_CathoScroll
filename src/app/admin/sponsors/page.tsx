import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { SponsorManager, type SponsorRecord } from '@/components/admin/SponsorManager';
import { SponsorFinancialManager } from '@/components/admin/SponsorFinancialManager';
import { requireAdminPage } from '@/lib/moderation/require-admin';

export const metadata = {
  title: 'Sponsor management',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminSponsorsPage() {
  const { user, adminClient } = await requireAdminPage('/admin/sponsors');
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

  const { data: membershipRows, error: membershipError } = await adminClient
    .from('sponsor_memberships')
    .select('id,sponsor_id,user_id,role,status')
    .order('created_at', { ascending: true })
    .limit(500);
  if (membershipError) {
    console.error('Unable to load sponsor memberships:', membershipError.message);
    throw new Error('Unable to load sponsor account access.');
  }

  const memberUserIds = [...new Set((membershipRows ?? []).map((membership) => membership.user_id))];
  const { data: profiles, error: profilesError } = memberUserIds.length
    ? await adminClient.from('profiles').select('id,display_name,username').in('id', memberUserIds)
    : { data: [], error: null };
  if (profilesError) {
    console.error('Unable to load sponsor account profiles:', profilesError.message);
    throw new Error('Unable to load sponsor account profiles.');
  }

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const memberships = (membershipRows ?? []).map((membership) => ({
    ...membership,
    display_name: profilesById.get(membership.user_id)?.display_name ?? null,
    username: profilesById.get(membership.user_id)?.username ?? null,
  }));

  const financialEntries = await Promise.all(
    (data ?? []).map(async (sponsor) => {
      const { data: financials, error: financialError } = await adminClient.rpc('get_admin_sponsor_financials', {
        p_actor_user_id: user.id,
        p_sponsor_id: sponsor.id,
      });
      if (financialError) {
        console.error('Unable to load sponsor financial records:', financialError.message);
        return [sponsor.id, { invoices: [], transactions: [] }] as const;
      }
      return [sponsor.id, financials ?? { invoices: [], transactions: [] }] as const;
    })
  );
  const financialsBySponsor = Object.fromEntries(financialEntries);

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
      <SponsorManager sponsors={(data ?? []) as SponsorRecord[]} memberships={memberships} />
      <SponsorFinancialManager
        sponsors={(data ?? []) as SponsorRecord[]}
        financialsBySponsor={financialsBySponsor}
      />
    </main>
  );
}
