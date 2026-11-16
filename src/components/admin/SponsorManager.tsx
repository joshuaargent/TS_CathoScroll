'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

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

export function SponsorManager({ sponsors }: { sponsors: SponsorRecord[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
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
      paymentReference: formData.get('paymentReference'),
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
            CathoScroll bank account and reconciled manually here; this form does not collect bank
            details or initiate a payment.
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
                <option value="received">Received in bank</option>
                <option value="not_required">No payment required</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Bank-transfer reference
              <input
                name="paymentReference"
                maxLength={120}
                className="border-border bg-bg-primary mt-2 w-full rounded-lg border px-3 py-2.5"
                placeholder="Statement reference or internal note"
              />
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
              Sponsors added above will appear here.
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
                    <td className="px-4 py-4 align-top">{humanize(sponsor.status)}</td>
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
