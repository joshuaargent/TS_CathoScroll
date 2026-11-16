import { AdminNavigation } from '@/components/admin/AdminNavigation';
import {
  SponsorCampaignManager,
  type SponsorCampaignRecord,
  type SponsorOption,
} from '@/components/admin/SponsorCampaignManager';
import { requireAdminPage } from '@/lib/moderation/require-admin';

export const metadata = {
  title: 'Sponsor campaigns',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminSponsorCampaignsPage() {
  const { adminClient } = await requireAdminPage('/admin/sponsor-campaigns');
  const [{ data: campaignData, error: campaignError }, { data: sponsorData, error: sponsorError }] =
    await Promise.all([
      adminClient
        .from('sponsor_campaigns')
        .select(
          'id,sponsor_id,campaign_name,headline,body,image_url,destination_url,cta_label,starts_on,ends_on,target_category_slugs,placement_weight,frequency_cap_per_user_24h,frequency_cap_per_user_total,daily_impression_cap,total_impression_cap,served_count,status,approved_at,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(100),
      adminClient
        .from('sponsors')
        .select('id,sponsor_name,status,payment_status')
        .order('sponsor_name', { ascending: true })
        .limit(200),
    ]);

  if (campaignError || sponsorError) {
    console.error('Unable to load sponsor campaigns:', campaignError?.message, sponsorError?.message);
    throw new Error('Unable to load sponsor campaign management.');
  }

  const sponsors = (sponsorData ?? []) as SponsorOption[];
  const sponsorById = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));
  const campaigns = ((campaignData ?? []) as Omit<SponsorCampaignRecord, 'sponsor_name' | 'sponsor_payment_status' | 'sponsor_status'>[])
    .map((campaign) => ({
      ...campaign,
      sponsor_name: sponsorById.get(campaign.sponsor_id)?.sponsor_name ?? 'Unknown sponsor',
      sponsor_payment_status: sponsorById.get(campaign.sponsor_id)?.payment_status ?? 'pending',
      sponsor_status: sponsorById.get(campaign.sponsor_id)?.status ?? 'draft',
    }));

  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Sponsor campaigns</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Create campaigns, set targeting and paid delivery weight, configure frequency and
          impression caps, and approve or pause placements. Approval requires an active sponsor
          with a bank transfer recorded as received.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <SponsorCampaignManager campaigns={campaigns} sponsors={sponsors} />
    </main>
  );
}
