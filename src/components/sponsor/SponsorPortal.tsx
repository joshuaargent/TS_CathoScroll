'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface SponsorOrganization {
  id: string;
  sponsor_name: string;
  status: string;
  payment_status: string;
  agreed_amount_minor: number | null;
  currency: string;
  role: 'owner' | 'manager' | 'analyst';
}

export interface SponsorCampaignRecord {
  id: string;
  sponsor_id: string;
  campaign_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  destination_url: string;
  cta_label: string;
  starts_on: string;
  ends_on: string;
  target_category_slugs: string[];
  target_topic_ids: string[];
  status: string;
  created_at: string;
}

interface CampaignMetric {
  campaign_id: string;
  campaign_name: string;
  status: string;
  viewable_impressions: number;
  clicks: number;
  click_through_rate: number;
}

export interface SponsorAnalytics {
  from: string;
  to: string;
  campaigns: CampaignMetric[];
}

interface SponsorInvoiceRecord {
  id: string;
  invoice_number: number;
  description: string;
  amount_minor: number;
  currency: string;
  issued_on: string;
  due_on: string;
  status: string;
  paid_minor: number;
  balance_minor: number;
}

interface SponsorPaymentRecord {
  id: string;
  invoice_id: string;
  transaction_type: 'payment' | 'refund';
  amount_minor: number;
  currency: string;
  bank_reference: string | null;
  bank_transaction_date: string | null;
  received_at: string;
}

export interface SponsorFinancials {
  invoices: SponsorInvoiceRecord[];
  transactions: SponsorPaymentRecord[];
}

interface CampaignForm {
  campaignName: string;
  headline: string;
  body: string;
  imageUrl: string;
  destinationUrl: string;
  ctaLabel: string;
  startsOn: string;
  endsOn: string;
  targetCategorySlugs: string;
  targetTopicIds: string;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyCampaignForm(): CampaignForm {
  const today = todayUtc();
  return {
    campaignName: '',
    headline: '',
    body: '',
    imageUrl: '',
    destinationUrl: '',
    ctaLabel: 'Learn more',
    startsOn: today,
    endsOn: addDays(today, 30),
    targetCategorySlugs: '',
    targetTopicIds: '',
  };
}

function formatMoney(amountMinor: number | null, currency: string) {
  if (amountMinor === null) return 'Not specified';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
}

export function SponsorPortal({
  organizations,
  campaigns,
  analyticsBySponsor,
  financialsBySponsor,
}: {
  organizations: SponsorOrganization[];
  campaigns: SponsorCampaignRecord[];
  analyticsBySponsor: Record<string, SponsorAnalytics>;
  financialsBySponsor: Record<string, SponsorFinancials>;
}) {
  const router = useRouter();
  const [selectedSponsorId, setSelectedSponsorId] = useState(organizations[0]?.id ?? '');
  const [form, setForm] = useState<CampaignForm>(emptyCampaignForm);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedOrganization = organizations.find((item) => item.id === selectedSponsorId) ?? organizations[0]!;
  const canManage = selectedOrganization?.role === 'owner' || selectedOrganization?.role === 'manager';
  const sponsorCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.sponsor_id === selectedOrganization?.id),
    [campaigns, selectedOrganization?.id]
  );
  const analytics = selectedOrganization ? analyticsBySponsor[selectedOrganization.id] : undefined;
  const metricsByCampaign = new Map((analytics?.campaigns ?? []).map((metric) => [metric.campaign_id, metric]));

  function updateForm<K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editCampaign(campaign: SponsorCampaignRecord) {
    setEditingCampaignId(campaign.id);
    setSelectedSponsorId(campaign.sponsor_id);
    setForm({
      campaignName: campaign.campaign_name,
      headline: campaign.headline,
      body: campaign.body,
      imageUrl: campaign.image_url ?? '',
      destinationUrl: campaign.destination_url,
      ctaLabel: campaign.cta_label,
      startsOn: campaign.starts_on,
      endsOn: campaign.ends_on,
      targetCategorySlugs: campaign.target_category_slugs.join(', '),
      targetTopicIds: campaign.target_topic_ids.join(', '),
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingCampaignId(null);
    setForm(emptyCampaignForm());
  }

  async function submitCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganization || !canManage || submitting) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    const payload = {
      sponsorId: selectedOrganization.id,
      campaignName: form.campaignName,
      headline: form.headline,
      body: form.body,
      imageUrl: form.imageUrl || null,
      destinationUrl: form.destinationUrl,
      ctaLabel: form.ctaLabel || 'Learn more',
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      targetCategorySlugs: form.targetCategorySlugs.split(',').map((item) => item.trim()).filter(Boolean),
      targetTopicIds: form.targetTopicIds.split(',').map((item) => item.trim()).filter(Boolean),
    };

    try {
      const response = await fetch(
        editingCampaignId
          ? `/api/sponsor/campaigns/${encodeURIComponent(editingCampaignId)}`
          : '/api/sponsor/campaigns',
        {
          method: editingCampaignId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const result: { error?: string; campaign?: { campaign_name?: string } } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to submit campaign.');
      setSuccess(
        editingCampaignId
          ? 'Campaign changes submitted. The campaign remains subject to administrator review.'
          : `${result.campaign?.campaign_name ?? 'Campaign'} submitted for administrator approval.`
      );
      resetForm();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit campaign.');
    } finally {
      setSubmitting(false);
    }
  }

  if (organizations.length === 0) {
    return (
      <div className="border-border rounded-2xl border p-8 text-center">
        <h2 className="text-xl font-bold">No sponsor organisation linked</h2>
        <p className="text-text-secondary mx-auto mt-2 max-w-xl text-sm">
          Your CathoScroll account does not currently have sponsor access. Contact the CathoScroll
          administration team if you believe this is incorrect.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {organizations.length > 1 && (
        <label className="block max-w-md text-sm font-semibold">
          Sponsor organisation
          <select
            value={selectedOrganization.id}
            onChange={(event) => {
              setSelectedSponsorId(event.target.value);
              resetForm();
            }}
            className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.sponsor_name}</option>
            ))}
          </select>
        </label>
      )}

      <section className="border-border bg-bg-secondary/40 rounded-2xl border p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Organisation</p>
            <h2 className="mt-1 text-2xl font-bold">{selectedOrganization.sponsor_name}</h2>
            <p className="text-text-secondary mt-1 text-sm">
              Access role: {humanize(selectedOrganization.role)} · Account status: {humanize(selectedOrganization.status)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-text-muted text-xs uppercase tracking-wider">Agreed amount</p>
            <p className="mt-1 text-xl font-bold">{formatMoney(selectedOrganization.agreed_amount_minor, selectedOrganization.currency)}</p>
            <p className="text-text-secondary mt-1 text-xs">Payment: {humanize(selectedOrganization.payment_status)}</p>
          </div>
        </div>
      </section>

      {canManage && (
        <section className="border-border bg-bg-secondary rounded-2xl border p-5 md:p-7">
          <div className="mb-6">
            <h2 className="text-2xl font-bold">{editingCampaignId ? 'Edit campaign submission' : 'Submit a campaign'}</h2>
            <p className="text-text-secondary mt-2 max-w-3xl text-sm">
              Campaigns are sent to CathoScroll for review. They do not appear in the feed until an
              administrator approves them and confirms the sponsor's payment requirements are met.
              Changes to approved campaigns must be requested from the administration team.
            </p>
          </div>
          <form onSubmit={submitCampaign} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Campaign name
                <input required minLength={2} maxLength={120} value={form.campaignName} onChange={(event) => updateForm('campaignName', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Headline
                <input required minLength={2} maxLength={100} value={form.headline} onChange={(event) => updateForm('headline', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
            </div>
            <label className="block text-sm font-medium">
              Message
              <textarea required minLength={2} maxLength={500} rows={4} value={form.body} onChange={(event) => updateForm('body', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Image URL (HTTPS)
                <input type="url" value={form.imageUrl} onChange={(event) => updateForm('imageUrl', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="https://example.com/image.jpg" />
              </label>
              <label className="block text-sm font-medium">
                Destination URL (HTTPS)
                <input type="url" required value={form.destinationUrl} onChange={(event) => updateForm('destinationUrl', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="https://example.com" />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium">
                Button label
                <input required minLength={2} maxLength={32} value={form.ctaLabel} onChange={(event) => updateForm('ctaLabel', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                Start date
                <input type="date" required value={form.startsOn} onChange={(event) => updateForm('startsOn', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
              <label className="block text-sm font-medium">
                End date
                <input type="date" required min={form.startsOn} value={form.endsOn} onChange={(event) => updateForm('endsOn', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Category targeting (optional)
                <input value={form.targetCategorySlugs} onChange={(event) => updateForm('targetCategorySlugs', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="e.g. prayer, scripture" />
                <span className="text-text-muted mt-1 block text-xs">Comma-separated category slugs. Leave blank for all categories.</span>
              </label>
              <label className="block text-sm font-medium">
                Topic targeting (optional)
                <input value={form.targetTopicIds} onChange={(event) => updateForm('targetTopicIds', event.target.value)} className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5" placeholder="Comma-separated topic IDs" />
                <span className="text-text-muted mt-1 block text-xs">Leave blank for all topics.</span>
              </label>
            </div>
            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
            {success && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={submitting} className="bg-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50">
                {submitting ? 'Submitting…' : editingCampaignId ? 'Submit changes for review' : 'Submit campaign for review'}
              </button>
              {editingCampaignId && (
                <button type="button" onClick={resetForm} className="border-border rounded-lg border px-5 py-2.5 text-sm font-semibold">
                  Cancel editing
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Invoices and payments</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Your organisation's invoices and recorded bank transfers. Partial payments and outstanding balances are shown separately.
          </p>
        </div>
        {(() => {
          const financials = financialsBySponsor[selectedOrganization.id] ?? { invoices: [], transactions: [] };
          return financials.invoices.length === 0 ? (
            <div className="border-border rounded-xl border p-6 text-center">
              <p className="font-semibold">No invoices yet</p>
              <p className="text-text-secondary mt-1 text-sm">Invoices issued by CathoScroll will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {financials.invoices.map((invoice) => {
                const invoiceTransactions = financials.transactions.filter((transaction) => transaction.invoice_id === invoice.id);
                return (
                  <article key={invoice.id} className="border-border rounded-xl border p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">CS-{invoice.issued_on.slice(0, 4)}-{String(invoice.invoice_number).padStart(6, '0')}</h3>
                        <p className="text-text-secondary mt-1 text-sm">{invoice.description}</p>
                        <p className="text-text-muted mt-1 text-xs">Issued {invoice.issued_on} · Due {invoice.due_on} · {humanize(invoice.status)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatMoney(invoice.amount_minor, invoice.currency)}</p>
                        <p className="text-text-secondary mt-1 text-xs">Outstanding: {formatMoney(invoice.balance_minor, invoice.currency)}</p>
                      </div>
                    </div>
                    {invoiceTransactions.length > 0 && (
                      <div className="border-border mt-4 space-y-2 border-t pt-3">
                        <p className="text-sm font-semibold">Recorded bank transactions</p>
                        {invoiceTransactions.map((transaction) => (
                          <div key={transaction.id} className="flex flex-wrap justify-between gap-2 text-sm">
                            <span className="text-text-secondary">
                              {humanize(transaction.transaction_type)} · {transaction.bank_reference || 'No bank reference'} · {transaction.bank_transaction_date || new Date(transaction.received_at).toLocaleDateString('en-GB')}
                            </span>
                            <span className="font-medium tabular-nums">{transaction.transaction_type === 'refund' ? '−' : ''}{formatMoney(transaction.amount_minor, transaction.currency)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          );
        })()}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Campaign performance</h2>
          <p className="text-text-secondary mt-1 text-sm">Aggregate reporting for the last 30 days. Individual user identities are never shared.</p>
        </div>
        {sponsorCampaigns.length === 0 ? (
          <div className="border-border rounded-xl border p-7 text-center">
            <p className="font-semibold">No campaigns yet</p>
            <p className="text-text-secondary mt-1 text-sm">Your submitted campaigns will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sponsorCampaigns.map((campaign) => {
              const metric = metricsByCampaign.get(campaign.id);
              const editable = ['draft', 'pending_approval', 'rejected'].includes(campaign.status);
              return (
                <article key={campaign.id} className="border-border rounded-xl border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold">{campaign.campaign_name}</h3>
                      <p className="text-text-secondary mt-1 text-sm">{campaign.headline}</p>
                      <p className="text-text-muted mt-2 text-xs">{campaign.starts_on} – {campaign.ends_on} · {humanize(campaign.status)}</p>
                    </div>
                    {canManage && editable && (
                      <button type="button" onClick={() => editCampaign(campaign)} className="border-border rounded-lg border px-3 py-2 text-xs font-semibold">
                        Edit submission
                      </button>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">

                    <div><p className="text-text-muted text-xs">Opted-in viewable</p><p className="mt-1 font-semibold tabular-nums">{(metric?.viewable_impressions ?? 0).toLocaleString('en-GB')}</p></div>
                    <div><p className="text-text-muted text-xs">Opted-in clicks</p><p className="mt-1 font-semibold tabular-nums">{(metric?.clicks ?? 0).toLocaleString('en-GB')}</p></div>
                    <div><p className="text-text-muted text-xs">Opted-in CTR</p><p className="mt-1 font-semibold tabular-nums">{(metric?.click_through_rate ?? 0).toFixed(2)}%</p></div>
                  </div>
                  <p className="text-text-muted mt-3 text-xs">Sponsor viewability, clicks and frequency are measured only for signed-in accounts that explicitly enable Sponsor measurement. Sponsor deliveries are not counted.</p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
