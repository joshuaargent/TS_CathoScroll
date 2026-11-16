import { redirect } from 'next/navigation';

import { SponsorPortal, type SponsorAnalytics, type SponsorCampaignRecord, type SponsorOrganization } from '@/components/sponsor/SponsorPortal';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const metadata = {
  title: 'Sponsor portal',
  robots: { index: false, follow: false },
};

export default async function SponsorPortalPage() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/signin?next=%2Fsponsor');

  const adminClient = createServiceRoleClient();
  const { data: membershipRows, error: membershipError } = await adminClient
    .from('sponsor_memberships')
    .select('sponsor_id,role,status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (membershipError) {
    console.error('Unable to load sponsor portal memberships:', membershipError.message);
    throw new Error('Unable to load sponsor portal.');
  }

  const sponsorIds = [...new Set((membershipRows ?? []).map((membership) => membership.sponsor_id))];
  const [{ data: sponsorRows, error: sponsorsError }, { data: campaignRows, error: campaignsError }] =
    sponsorIds.length
      ? await Promise.all([
          adminClient
            .from('sponsors')
            .select('id,sponsor_name,status,payment_status,agreed_amount_minor,currency')
            .in('id', sponsorIds),
          adminClient
            .from('sponsor_campaigns')
            .select('id,sponsor_id,campaign_name,headline,body,image_url,destination_url,cta_label,starts_on,ends_on,target_category_slugs,target_topic_ids,status,created_at')
            .in('sponsor_id', sponsorIds)
            .order('created_at', { ascending: false })
            .limit(200),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  if (sponsorsError || campaignsError) {
    console.error('Unable to load sponsor portal data:', sponsorsError?.message ?? campaignsError?.message);
    throw new Error('Unable to load sponsor portal data.');
  }

  const roleBySponsor = new Map((membershipRows ?? []).map((membership) => [membership.sponsor_id, membership.role]));
  const organizations: SponsorOrganization[] = (sponsorRows ?? []).map((sponsor) => ({
    ...sponsor,
    role: roleBySponsor.get(sponsor.id) as SponsorOrganization['role'],
  }));
  const campaigns = (campaignRows ?? []) as SponsorCampaignRecord[];

  const analyticsEntries = await Promise.all(
    organizations.map(async (organization) => {
      const { data, error } = await adminClient.rpc('get_sponsor_campaign_analytics', {
        p_actor_user_id: user.id,
        p_sponsor_id: organization.id,
      });
      if (error) {
        console.error('Unable to load sponsor campaign analytics:', error.message);
        return [organization.id, { from: '', to: '', campaigns: [] }] as const;
      }
      return [organization.id, data as SponsorAnalytics] as const;
    })
  );

  const analyticsBySponsor = Object.fromEntries(analyticsEntries) as Record<string, SponsorAnalytics>;

  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Partner area</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Sponsor portal</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Manage campaign submissions and review aggregate delivery performance for the sponsor
          organisations linked to your CathoScroll account.
        </p>
      </div>
      <div className="mt-8">
        <SponsorPortal
          organizations={organizations}
          campaigns={campaigns}
          analyticsBySponsor={analyticsBySponsor}
        />
      </div>
    </main>
  );
}
