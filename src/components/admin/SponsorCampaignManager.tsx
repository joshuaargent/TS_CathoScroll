'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface SponsorOption {
  id: string;
  sponsor_name: string;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';
  payment_status: 'pending' | 'received' | 'not_required' | 'refunded';
}

export interface SponsorCampaignAnalytics {
  campaign_id: string;
  served: number;
  viewable_impressions: number;
  clicks: number;
  click_through_rate: number;
  anonymous_served: number;
  anonymous_viewable_impressions: number;
  anonymous_clicks: number;
}

export interface SponsorCampaignRecord {
  id: string;
  sponsor_id: string;
  sponsor_name: string;
  sponsor_status: string;
  sponsor_payment_status: string;
  campaign_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  destination_url: string;
  cta_label: string;
  starts_on: string;
  ends_on: string;
  target_category_slugs: string[];
  placement_weight: number;
  frequency_cap_per_user_24h: number;
  frequency_cap_per_user_total: number;
  daily_impression_cap: number | null;
  total_impression_cap: number | null;
  served_count: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'paused' | 'completed' | 'rejected';
  approved_at: string | null;
  created_at: string;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function eligibleForApproval(campaign: SponsorCampaignRecord) {
  return (
    ['active', 'scheduled'].includes(campaign.sponsor_status) &&
    ['received', 'not_required'].includes(campaign.sponsor_payment_status)
  );
}

export function SponsorCampaignManager({
  campaigns,
  sponsors,
  analytics,
  analyticsFrom,
  analyticsTo,
}: {
  campaigns: SponsorCampaignRecord[];
  sponsors: SponsorOption[];
  analytics: Record<string, SponsorCampaignAnalytics>;
  analyticsFrom: string;
  analyticsTo: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      sponsorId: formData.get('sponsorId'),
      campaignName: formData.get('campaignName'),
      headline: formData.get('headline'),
      body: formData.get('body'),
      imageUrl: formData.get('imageUrl'),
      destinationUrl: formData.get('destinationUrl'),
      ctaLabel: formData.get('ctaLabel'),
      startsOn: formData.get('startsOn'),
      endsOn: formData.get('endsOn'),
      targetCategorySlugs: formData.get('targetCategorySlugs'),
      placementWeight: formData.get('placementWeight'),
      frequencyCapPerUser24h: formData.get('frequencyCapPerUser24h'),
      frequencyCapPerUserTotal: formData.get('frequencyCapPerUserTotal'),
      dailyImpressionCap: formData.get('dailyImpressionCap'),
      totalImpressionCap: formData.get('totalImpressionCap'),
    };

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/admin/sponsor-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result: { error?: string; campaign?: { campaign_name?: string } } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to create campaign.');
      setSuccess(`${result.campaign?.campaign_name ?? 'Campaign'} was created as a draft.`);
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create campaign.');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(campaignId: string, action: 'approve' | 'pause' | 'resume' | 'complete' | 'reject') {
    if (updatingId) return;
    setUpdatingId(campaignId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/sponsor-campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result: { error?: string; campaign?: { campaign_name?: string; status?: string } } =
        await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to update campaign.');
      setSuccess(`${result.campaign?.campaign_name ?? 'Campaign'} is now ${humanize(result.campaign?.status ?? action)}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update campaign.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="mt-10 space-y-10">
      <section className="border-border bg-bg-secondary rounded-2xl border p-5 md:p-7">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Create campaign</h2>
          <p className="text-text-secondary mt-2 max-w-3xl text-sm">
            Campaigns start as drafts. Paid weight controls the proportional share of eligible
            sponsored placements; it does not affect organic topic recommendations.
          </p>
        </div>

        {sponsors.length === 0 ? (
          <p className="text-text-secondary rounded-lg border border-dashed p-4 text-sm">
            Add a sponsor and reconcile its bank transfer before creating a campaign.
          </p>
        ) : (
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Sponsor <span className="text-red-600">*</span>
                <select
                  name="sponsorId"
                  required
                  defaultValue=""
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                >
                  <option value="" disabled>Select sponsor</option>
                  {sponsors.map((sponsor) => (
                    <option key={sponsor.id} value={sponsor.id}>
                      {sponsor.sponsor_name} — {humanize(sponsor.status)} / {humanize(sponsor.payment_status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Campaign name <span className="text-red-600">*</span>
                <input
                  name="campaignName"
                  required
                  minLength={2}
                  maxLength={120}
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                  placeholder="Spring campaign"
                />
              </label>
              <label className="block text-sm font-medium md:col-span-2">
                Headline <span className="text-red-600">*</span>
                <input
                  name="headline"
                  required
                  minLength={2}
                  maxLength={100}
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                  placeholder="A clear, short sponsor headline"
                />
              </label>
            </div>

            <label className="block text-sm font-medium">
              Campaign description <span className="text-red-600">*</span>
              <textarea
                name="body"
                required
                minLength={2}
                maxLength={500}
                rows={3}
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="Explain what the sponsor is offering."
              />
            </label>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Creative image URL
                <input
                  name="imageUrl"
                  type="url"
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                  placeholder="https://example.com/campaign-image.jpg"
                />
              </label>
              <label className="block text-sm font-medium">
                Destination URL <span className="text-red-600">*</span>
                <input
                  name="destinationUrl"
                  type="url"
                  required
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                  placeholder="https://example.com/landing-page"
                />
              </label>
              <label className="block text-sm font-medium">
                Button label
                <input
                  name="ctaLabel"
                  maxLength={32}
                  defaultValue="Learn more"
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                />
              </label>
              <label className="block text-sm font-medium">
                Target category slugs
                <input
                  name="targetCategorySlugs"
                  className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                  placeholder="blank = all categories"
                />
                <span className="text-text-muted mt-1 block text-xs">
                  Comma-separated category slugs. Leave blank for all categories.
                </span>
              </label>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm font-medium">
                Start date <span className="text-red-600">*</span>
                <input name="startsOn" type="date" required className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                End date <span className="text-red-600">*</span>
                <input name="endsOn" type="date" required className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Paid delivery weight
                <input name="placementWeight" type="number" min="1" max="1000" step="1" defaultValue="1" required className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Max impressions per day
                <input name="dailyImpressionCap" type="number" min="1" max="1000000000" step="1" className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="Unlimited" />
              </label>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm font-medium">
                Max impressions per user / 24h
                <input name="frequencyCapPerUser24h" type="number" min="1" max="25" step="1" defaultValue="1" required className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Max impressions per user / campaign
                <input name="frequencyCapPerUserTotal" type="number" min="1" max="50" step="1" defaultValue="3" required className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Total campaign impression cap
                <input name="totalImpressionCap" type="number" min="1" max="100000000000" step="1" className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="Unlimited" />
              </label>
            </div>

            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
            {success && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="bg-accent text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors"
            >
              {submitting ? 'Creating campaign…' : 'Create draft campaign'}
            </button>
          </form>
        )}
      </section>

      <section>
        <div className="mb-5">
          <h2 className="text-2xl font-bold">Campaign inventory</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Approval is blocked until the sponsor is active and its invoice balance/agreed payment is reconciled, or the sponsor is explicitly marked as payment-not-required.
            Performance below covers {formatDate(analyticsFrom)} to {formatDate(analyticsTo)}.
          </p>
        </div>
        {campaigns.length === 0 ? (
          <div className="border-border rounded-xl border px-5 py-10 text-center">
            <p className="font-semibold">No campaigns created</p>
            <p className="text-text-secondary mt-1 text-sm">New submissions will appear here for review. Until an eligible campaign is approved, the feed remains topic-only with no empty advertising slot.</p>
          </div>
        ) : (
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-bg-secondary text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Campaign</th>
                  <th className="px-4 py-3 font-semibold">Sponsor</th>
                  <th className="px-4 py-3 font-semibold">Schedule</th>
                  <th className="px-4 py-3 font-semibold">Weight / caps</th>
                  <th className="px-4 py-3 font-semibold">Performance (30 days)</th>
                  <th className="px-4 py-3 font-semibold">Lifetime delivery</th>
                  <th className="px-4 py-3 font-semibold">Status / actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-border border-t align-top">
                    <td className="px-4 py-4">
                      <p className="font-semibold">{campaign.campaign_name}</p>
                      <p className="text-text-secondary mt-1 max-w-xs">{campaign.headline}</p>
                      <p className="text-text-muted mt-1 text-xs">
                        {campaign.target_category_slugs.length
                          ? campaign.target_category_slugs.join(', ')
                          : 'All categories'}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium">{campaign.sponsor_name}</p>
                      <p className="text-text-muted mt-1 text-xs">
                        {humanize(campaign.sponsor_status)} / {humanize(campaign.sponsor_payment_status)}
                      </p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {formatDate(campaign.starts_on)}<br />– {formatDate(campaign.ends_on)}
                    </td>
                    <td className="px-4 py-4">
                      <p>Weight: {campaign.placement_weight}</p>
                      <p className="text-text-muted mt-1 text-xs">
                        {campaign.frequency_cap_per_user_24h} / 24h · {campaign.frequency_cap_per_user_total} total per user
                      </p>
                      <p className="text-text-muted mt-1 text-xs">
                        Daily: {campaign.daily_impression_cap ?? 'Unlimited'} · Total: {campaign.total_impression_cap ?? 'Unlimited'}
                      </p>
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {(() => {
                        const stats = analytics[campaign.id];
                        return (
                          <>
                            <p>{(stats?.served ?? 0).toLocaleString('en-GB')} signed-in served</p>
                            <p className="text-text-muted mt-1 text-xs">{(stats?.anonymous_served ?? 0).toLocaleString('en-GB')} anonymous served</p>
                            <p className="text-text-muted mt-1 text-xs">
                              {(stats?.viewable_impressions ?? 0).toLocaleString('en-GB')} signed-in viewable · {(stats?.anonymous_viewable_impressions ?? 0).toLocaleString('en-GB')} anonymous
                            </p>
                            <p className="text-text-muted mt-1 text-xs">
                              {(stats?.clicks ?? 0).toLocaleString('en-GB')} signed-in clicks · {(stats?.anonymous_clicks ?? 0).toLocaleString('en-GB')} anonymous
                            </p>
                            <p className="text-text-muted mt-1 text-xs">Combined CTR: {(stats?.click_through_rate ?? 0).toFixed(2)}%</p>
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {campaign.served_count.toLocaleString('en-GB')} served
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold">{humanize(campaign.status)}</p>
                      {campaign.status === 'approved' && (
                        <p className="text-text-muted mt-1 text-xs">
                          {campaign.starts_on > new Date().toISOString().slice(0, 10)
                            ? 'Approved · scheduled'
                            : 'Approved'}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {['draft', 'pending_approval'].includes(campaign.status) && (
                          <button
                            type="button"
                            disabled={updatingId !== null || !eligibleForApproval(campaign)}
                            onClick={() => void updateStatus(campaign.id, 'approve')}
                            title={!eligibleForApproval(campaign) ? 'Sponsor must be active and payment received first.' : undefined}
                            className="bg-accent text-white disabled:cursor-not-allowed disabled:opacity-40 rounded-md px-2.5 py-1.5 text-xs font-semibold"
                          >
                            Approve
                          </button>
                        )}
                        {campaign.status === 'approved' && (
                          <button type="button" disabled={updatingId !== null} onClick={() => void updateStatus(campaign.id, 'pause')} className="border-border rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40">
                            Pause
                          </button>
                        )}
                        {campaign.status === 'paused' && (
                          <button type="button" disabled={updatingId !== null || !eligibleForApproval(campaign)} onClick={() => void updateStatus(campaign.id, 'resume')} className="bg-accent text-white rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40">
                            Resume
                          </button>
                        )}
                        {['approved', 'paused'].includes(campaign.status) && (
                          <button type="button" disabled={updatingId !== null} onClick={() => void updateStatus(campaign.id, 'complete')} className="border-border rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40">
                            Complete
                          </button>
                        )}
                        {['draft', 'pending_approval', 'approved', 'paused'].includes(campaign.status) && (
                          <button type="button" disabled={updatingId !== null} onClick={() => void updateStatus(campaign.id, 'reject')} className="text-red-600 border border-red-500/30 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40">
                            Reject
                          </button>
                        )}
                        {updatingId === campaign.id && <span className="text-text-muted self-center text-xs">Saving…</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
