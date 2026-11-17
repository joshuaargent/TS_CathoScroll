'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface SponsorMembershipRecord {
  id: string;
  sponsor_id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'analyst';
  status: 'active' | 'suspended' | 'revoked';
  display_name: string | null;
  username: string | null;
}

export interface SponsorRecord {
  id: string;
  sponsor_name: string;
  contact_email: string | null;
  website_url: string | null;
  logo_url: string | null;
  description: string;
  starts_on: string | null;
  ends_on: string | null;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';
  agreed_amount_minor: number | null;
  currency: 'GBP' | 'EUR' | 'USD';
  payment_status: 'pending' | 'received' | 'not_required' | 'refunded';
  payment_received_at: string | null;
  payment_reference: string | null;
  admin_notes: string;
  created_at: string;
}

function formatMoney(amountMinor: number | null, currency: string) {
  if (amountMinor === null) return 'Not specified';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SponsorManager({ sponsors, memberships }: { sponsors: SponsorRecord[]; memberships: SponsorMembershipRecord[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [memberEmails, setMemberEmails] = useState<Record<string, string>>({});
  const [memberRoles, setMemberRoles] = useState<Record<string, 'owner' | 'manager' | 'analyst'>>({});
  const [memberUpdatingId, setMemberUpdatingId] = useState<string | null>(null);
  const [sponsorStatuses, setSponsorStatuses] = useState<Record<string, string>>({});
  const [sponsorStatusUpdatingId, setSponsorStatusUpdatingId] = useState<string | null>(null);

  async function updateSponsorStatus(sponsorId: string) {
    if (sponsorStatusUpdatingId) return;
    const status = sponsorStatuses[sponsorId];
    if (!status) return;
    setSponsorStatusUpdatingId(sponsorId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsorId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to update sponsor status.');
      setSuccess(`Sponsor status changed to ${status.replaceAll('_', ' ')}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update sponsor status.');
    } finally {
      setSponsorStatusUpdatingId(null);
    }
  }

  async function addSponsorMember(sponsorId: string) {
    if (memberUpdatingId) return;
    const email = (memberEmails[sponsorId] ?? '').trim();
    const role = memberRoles[sponsorId] ?? 'owner';
    if (!email) {
      setError('Enter the email address of an existing CathoScroll account.');
      return;
    }
    setMemberUpdatingId(sponsorId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsorId)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to grant sponsor access.');
      setMemberEmails((current) => ({ ...current, [sponsorId]: '' }));
      setSuccess(`Sponsor access granted to ${email}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to grant sponsor access.');
    } finally {
      setMemberUpdatingId(null);
    }
  }

  async function updateSponsorMember(sponsorId: string, membershipId: string, action: 'suspend' | 'reactivate' | 'revoke') {
    if (memberUpdatingId) return;
    setMemberUpdatingId(membershipId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsorId)}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId, action }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to update sponsor access.');
      setSuccess(`Sponsor account access ${action === 'revoke' ? 'revoked' : action === 'suspend' ? 'suspended' : 'restored'}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update sponsor access.');
    } finally {
      setMemberUpdatingId(null);
    }
  }


  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const agreedAmountInput = formData.get('agreedAmount');
    const agreedAmountValue = typeof agreedAmountInput === 'string' && agreedAmountInput.trim()
      ? Number(agreedAmountInput)
      : 0;
    if (formData.get('paymentStatus') === 'not_required' && agreedAmountValue > 0) {
      setError('A sponsor with an agreed fee must remain pending until its invoices are reconciled.');
      return;
    }
    const payload = {
      sponsorName: formData.get('sponsorName'),
      contactEmail: formData.get('contactEmail'),
      websiteUrl: formData.get('websiteUrl'),
      logoUrl: formData.get('logoUrl'),
      description: formData.get('description'),
      startsOn: formData.get('startsOn'),
      endsOn: formData.get('endsOn'),
      status: formData.get('status'),
      agreedAmount: formData.get('agreedAmount'),
      currency: formData.get('currency'),
      paymentStatus: formData.get('paymentStatus'),
      paymentReference: null,
      adminNotes: formData.get('adminNotes'),
    };

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/admin/sponsors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result: { error?: string; sponsor?: { sponsor_name?: string } } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to create sponsor.');

      setSuccess(`${result.sponsor?.sponsor_name ?? 'Sponsor'} was added.`);
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create sponsor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="border-border bg-bg-secondary rounded-2xl border p-5 md:p-7">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Create sponsor</h2>
          <p className="text-text-secondary mt-2 max-w-3xl text-sm">
            Record a sponsor and its agreed placement period. Payments are made directly to the
            CathoScroll bank account. Issue invoices and reconcile transfers in Sponsor financials
            below; this form does not collect bank details or initiate a payment.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Sponsor name <span className="text-red-600">*</span>
              <input
                name="sponsorName"
                required
                minLength={2}
                maxLength={120}
                autoComplete="organization"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="Organisation or business name"
              />
            </label>
            <label className="block text-sm font-medium">
              Contact email
              <input
                name="contactEmail"
                type="email"
                maxLength={254}
                autoComplete="email"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="sponsor@example.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Website
              <input
                name="websiteUrl"
                type="url"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="https://example.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Logo URL
              <input
                name="logoUrl"
                type="url"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="https://example.com/logo.png"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Sponsor description
            <textarea
              name="description"
              maxLength={500}
              rows={3}
              className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              placeholder="Short description to use alongside the sponsor's branding."
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm font-medium">
              Start date
              <input
                name="startsOn"
                type="date"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              />
            </label>
            <label className="block text-sm font-medium">
              End date
              <input
                name="endsOn"
                type="date"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              />
            </label>
            <label className="block text-sm font-medium">
              Sponsor status
              <select
                name="status"
                defaultValue="draft"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              >
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Agreed amount
              <input
                name="agreedAmount"
                type="number"
                min="0"
                max="1000000000"
                step="0.01"
                inputMode="decimal"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="e.g. 250.00"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm font-medium">
              Currency
              <select
                name="currency"
                defaultValue="GBP"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              >
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Bank-transfer payment status
              <select
                name="paymentStatus"
                defaultValue="pending"
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              >
                <option value="pending">Awaiting bank transfer</option>
                <option value="not_required">No payment required</option>
              </select>
            </label>
          </div>

          <label className="block text-sm font-medium">
            Internal notes
            <textarea
              name="adminNotes"
              maxLength={2000}
              rows={3}
              className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
              placeholder="Private agreement details, contact notes or delivery requirements."
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors"
          >
            {submitting ? 'Creating sponsor…' : 'Create sponsor'}
          </button>
        </form>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="text-2xl font-bold">Recorded sponsors</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Private administration records. Creating a record does not publish an advert in the app.
          </p>
        </div>

        {sponsors.length === 0 ? (
          <div className="border-border rounded-xl border px-5 py-10 text-center">
            <p className="font-semibold">No sponsors recorded</p>
            <p className="text-text-secondary mt-1 text-sm">
              Sponsors added above will appear here. Until an approved campaign exists, the feed remains topic-only with no empty advertising slot.
            </p>
          </div>
        ) : (
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-bg-secondary text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sponsor</th>
                  <th className="px-4 py-3 font-semibold">Period</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Agreed amount</th>
                  <th className="px-4 py-3 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody>
                {sponsors.map((sponsor) => (
                  <tr key={sponsor.id} className="border-border border-t">
                    <td className="px-4 py-4 align-top">
                      <p className="font-semibold">{sponsor.sponsor_name}</p>
                      {sponsor.contact_email && (
                        <p className="text-text-muted mt-1">{sponsor.contact_email}</p>
                      )}
                      {sponsor.website_url && (
                        <a
                          href={sponsor.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent mt-1 inline-block hover:underline"
                        >
                          Website
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top">
                      {formatDate(sponsor.starts_on)} – {formatDate(sponsor.ends_on)}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex min-w-[180px] flex-col gap-2">
                        <span className="font-medium">{humanize(sponsor.status)}</span>
                        <select
                          aria-label={`Sponsor status for ${sponsor.sponsor_name}`}
                          value={sponsorStatuses[sponsor.id] ?? sponsor.status}
                          onChange={(event) => setSponsorStatuses((current) => ({ ...current, [sponsor.id]: event.target.value }))}
                          className="border-border bg-bg-primary rounded-md border px-2 py-1.5 text-xs"
                        >
                          <option value="draft">Draft</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                        </select>
                        <button
                          type="button"
                          disabled={sponsorStatusUpdatingId !== null || (sponsorStatuses[sponsor.id] ?? sponsor.status) === sponsor.status}
                          onClick={() => void updateSponsorStatus(sponsor.id)}
                          className="border-border rounded-md border px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          {sponsorStatusUpdatingId === sponsor.id ? 'Saving…' : 'Update status'}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {formatMoney(sponsor.agreed_amount_minor, sponsor.currency)}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p>{humanize(sponsor.payment_status)}</p>
                      {sponsor.payment_reference && (
                        <p className="text-text-muted mt-1 text-xs">
                          Ref: {sponsor.payment_reference}
                        </p>
                      )}
                      {sponsor.payment_received_at && (
                        <p className="text-text-muted mt-1 text-xs">
                          Received {new Date(sponsor.payment_received_at).toLocaleDateString('en-GB')}
                        </p>
                      )}
                      {sponsor.payment_status === 'pending' && (
                        <p className="text-text-muted mt-2 text-xs">
                          Issue an invoice and reconcile bank transfers in Sponsor financials below.
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold">Sponsor account access</h2>
          <p className="text-text-secondary mt-1 max-w-3xl text-sm">
            Link existing CathoScroll accounts to sponsor organisations. The account must already
            exist; this does not create an Auth user or change email-verification settings.
          </p>
        </div>
        {sponsors.length === 0 ? (
          <p className="text-text-secondary rounded-xl border border-border p-5 text-sm">
            Create a sponsor record before assigning account access.
          </p>
        ) : (
          sponsors.map((sponsor) => {
            const sponsorMembers = memberships.filter((membership) => membership.sponsor_id === sponsor.id);
            return (
              <div key={sponsor.id} className="border-border rounded-2xl border p-5">
                <div className="mb-4">
                  <h3 className="font-semibold">{sponsor.sponsor_name}</h3>
                  <p className="text-text-muted mt-1 text-xs">
                    {sponsorMembers.length} linked account{sponsorMembers.length === 1 ? '' : 's'}
                  </p>
                </div>
                <form
                  className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addSponsorMember(sponsor.id);
                  }}
                >
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={memberEmails[sponsor.id] ?? ''}
                    onChange={(event) => setMemberEmails((current) => ({ ...current, [sponsor.id]: event.target.value }))}
                    placeholder="Existing account email"
                    aria-label={`Account email for ${sponsor.sponsor_name}`}
                    className="border-border bg-bg-primary min-w-0 rounded-lg border px-3 py-2.5 text-sm"
                  />
                  <select
                    value={memberRoles[sponsor.id] ?? 'owner'}
                    onChange={(event) => setMemberRoles((current) => ({
                      ...current,
                      [sponsor.id]: event.target.value as 'owner' | 'manager' | 'analyst',
                    }))}
                    aria-label={`Sponsor role for ${sponsor.sponsor_name}`}
                    className="border-border bg-bg-primary rounded-lg border px-3 py-2.5 text-sm"
                  >
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="analyst">Analyst</option>
                  </select>
                  <button
                    type="submit"
                    disabled={memberUpdatingId !== null}
                    className="bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    {memberUpdatingId === sponsor.id ? 'Adding…' : 'Grant access'}
                  </button>
                </form>
                {sponsorMembers.length === 0 ? (
                  <p className="text-text-muted text-sm">No accounts have access to this sponsor.</p>
                ) : (
                  <div className="divide-border divide-y">
                    {sponsorMembers.map((membership) => (
                      <div key={membership.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {membership.display_name || membership.username || 'CathoScroll account'}
                          </p>
                          <p className="text-text-muted mt-0.5 text-xs">
                            {membership.username ? `@${membership.username} · ` : ''}{membership.role} · {membership.status}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {membership.status === 'active' ? (
                            <button
                              type="button"
                              disabled={memberUpdatingId !== null}
                              onClick={() => void updateSponsorMember(sponsor.id, membership.id, 'suspend')}
                              className="border-border rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            >
                              Suspend
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={memberUpdatingId !== null}
                              onClick={() => void updateSponsorMember(sponsor.id, membership.id, 'reactivate')}
                              className="border-border rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            >
                              Reactivate
                            </button>
                          )}
                          {membership.status !== 'revoked' && (
                            <button
                              type="button"
                              disabled={memberUpdatingId !== null}
                              onClick={() => void updateSponsorMember(sponsor.id, membership.id, 'revoke')}
                              className="border border-red-500/30 rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
