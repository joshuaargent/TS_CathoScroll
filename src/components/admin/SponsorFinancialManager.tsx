'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface SponsorFinancialRecord {
  id: string;
  sponsor_name: string;
  agreed_amount_minor: number | null;
  currency: string;
}

interface SponsorInvoice {
  id: string;
  invoice_number: number;
  description: string;
  amount_minor: number;
  currency: string;
  issued_on: string;
  due_on: string;
  status: 'draft' | 'issued' | 'paid' | 'void';
  paid_minor: number;
  balance_minor: number;
}

interface SponsorPayment {
  id: string;
  invoice_id: string;
  transaction_type: 'payment' | 'refund';
  amount_minor: number;
  currency: string;
  bank_reference: string | null;
  bank_transaction_date: string | null;
  received_at: string;
  refund_of_payment_id: string | null;
}

interface SponsorFinancials {
  invoices: SponsorInvoice[];
  transactions: SponsorPayment[];
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
}

function amountToMinor(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function SponsorFinancialCard({
  sponsor,
  financials,
}: {
  sponsor: SponsorFinancialRecord;
  financials: SponsorFinancials;
}) {
  const router = useRouter();
  const today = todayUtc();
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refundsByPayment = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of financials.transactions) {
      if (transaction.transaction_type === 'refund' && transaction.refund_of_payment_id) {
        totals.set(
          transaction.refund_of_payment_id,
          (totals.get(transaction.refund_of_payment_id) ?? 0) + transaction.amount_minor
        );
      }
    }
    return totals;
  }, [financials.transactions]);

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingInvoice) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = amountToMinor(data.get('amount'));
    if (amount === null) {
      setError('Enter a valid invoice amount greater than zero.');
      return;
    }
    setCreatingInvoice(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsor.id)}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: data.get('description'),
          amount: String(data.get('amount')),
          currency: data.get('currency'),
          issuedOn: data.get('issuedOn'),
          dueOn: data.get('dueOn'),
          issueNow: true,
        }),
      });
      const result: { error?: string; invoice?: { invoice_number?: number } } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to create invoice.');
      setSuccess(`Invoice ${result.invoice?.invoice_number ?? ''} issued.`);
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create invoice.');
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function recordPayment(invoice: SponsorInvoice, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = amountToMinor(data.get('amount'));
    if (amount === null || amount > invoice.balance_minor) {
      setError(`Enter an amount no greater than the outstanding balance of ${money(invoice.balance_minor, invoice.currency)}.`);
      return;
    }
    setBusyId(invoice.id);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(
        `/api/admin/sponsors/${encodeURIComponent(sponsor.id)}/invoices/${encodeURIComponent(invoice.id)}/payments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: String(data.get('amount')),
            currency: invoice.currency,
            bankReference: data.get('bankReference'),
            bankTransactionDate: data.get('bankTransactionDate'),
            bankTransactionKey: data.get('bankTransactionKey'),
          }),
        }
      );
      const result: { error?: string; payment?: { duplicate?: boolean } } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to reconcile payment.');
      setSuccess(result.payment?.duplicate ? 'This bank transaction was already reconciled.' : 'Bank payment recorded and allocated to the invoice.');
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reconcile payment.');
    } finally {
      setBusyId(null);
    }
  }

  async function recordRefund(payment: SponsorPayment, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = amountToMinor(data.get('amount'));
    const remaining = payment.amount_minor - (refundsByPayment.get(payment.id) ?? 0);
    if (amount === null || amount > remaining) {
      setError(`Enter a refund no greater than ${money(remaining, payment.currency)}.`);
      return;
    }
    setBusyId(payment.id);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(
        `/api/admin/sponsors/${encodeURIComponent(sponsor.id)}/payments/${encodeURIComponent(payment.id)}/refunds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: String(data.get('amount')),
            bankReference: data.get('bankReference'),
            bankTransactionDate: data.get('bankTransactionDate'),
            bankTransactionKey: data.get('bankTransactionKey'),
          }),
        }
      );
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to record refund.');
      setSuccess('Refund recorded against the original payment.');
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record refund.');
    } finally {
      setBusyId(null);
    }
  }

  const outstandingTotal = financials.invoices
    .filter((invoice) => invoice.status !== 'void')
    .reduce((total, invoice) => total + invoice.balance_minor, 0);

  return (
    <section className="border-border rounded-2xl border p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">{sponsor.sponsor_name}</h3>
          <p className="text-text-secondary mt-1 text-sm">Invoices, bank transfers, partial payments and refunds</p>
        </div>
        <div className="text-right">
          <p className="text-text-muted text-xs uppercase tracking-wider">Outstanding invoices</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{money(outstandingTotal, sponsor.currency)}</p>
        </div>
      </div>

      <details className="border-border bg-bg-secondary/50 rounded-xl border p-4" open={financials.invoices.length === 0}>
        <summary className="cursor-pointer font-semibold">Create and issue invoice</summary>
        <form onSubmit={createInvoice} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium md:col-span-2">
            Description
            <input name="description" required minLength={2} maxLength={500} className="border-border bg-bg-primary mt-1.5 w-full rounded-lg border px-3 py-2.5" placeholder="e.g. CathoScroll sponsored placement — November" />
          </label>
          <label className="text-sm font-medium">
            Amount
            <input name="amount" required type="number" min="0.01" step="0.01" defaultValue={sponsor.agreed_amount_minor === null ? '' : (sponsor.agreed_amount_minor / 100).toFixed(2)} className="border-border bg-bg-primary mt-1.5 w-full rounded-lg border px-3 py-2.5" />
          </label>
          <div className="text-sm font-medium">
            Invoice currency
            <input type="hidden" name="currency" value={sponsor.currency} />
            <p className="border-border bg-bg-primary mt-1.5 rounded-lg border px-3 py-2.5">{sponsor.currency}</p>
          </div>
          <label className="text-sm font-medium">
            Issue date
            <input name="issuedOn" type="date" required defaultValue={today} className="border-border bg-bg-primary mt-1.5 w-full rounded-lg border px-3 py-2.5" />
          </label>
          <label className="text-sm font-medium">
            Due date
            <input name="dueOn" type="date" required min={today} defaultValue={addDays(today, 30)} className="border-border bg-bg-primary mt-1.5 w-full rounded-lg border px-3 py-2.5" />
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={creatingInvoice} className="bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
              {creatingInvoice ? 'Issuing…' : 'Issue invoice'}
            </button>
          </div>
        </form>
      </details>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {success && <p role="status" className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}

      <div className="mt-5 space-y-3">
        {financials.invoices.length === 0 ? (
          <p className="text-text-muted py-5 text-center text-sm">No invoices recorded for this sponsor.</p>
        ) : financials.invoices.map((invoice) => {
          const overdue = invoice.status === 'issued' && invoice.balance_minor > 0 && invoice.due_on < today;
          const invoicePayments = financials.transactions.filter((transaction) => transaction.invoice_id === invoice.id);
          return (
            <article key={invoice.id} className="border-border rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">CS-{invoice.issued_on.slice(0, 4)}-{String(invoice.invoice_number).padStart(6, '0')}</p>
                  <p className="text-text-secondary mt-1 text-sm">{invoice.description}</p>
                  <p className="text-text-muted mt-1 text-xs">Issued {invoice.issued_on} · Due {invoice.due_on}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(invoice.amount_minor, invoice.currency)}</p>
                  <p className={`mt-1 text-xs font-semibold ${overdue ? 'text-red-600' : 'text-text-secondary'}`}>
                    {overdue ? 'Overdue' : invoice.status === 'paid' ? 'Paid' : invoice.status === 'void' ? 'Void' : humanize(invoice.status)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div><p className="text-text-muted text-xs">Paid</p><p className="mt-1 font-semibold tabular-nums">{money(invoice.paid_minor, invoice.currency)}</p></div>
                <div><p className="text-text-muted text-xs">Outstanding</p><p className="mt-1 font-semibold tabular-nums">{money(invoice.balance_minor, invoice.currency)}</p></div>
              </div>
              {invoice.status === 'issued' && invoice.balance_minor > 0 && (
                <details className="mt-4 border-border border-t pt-3">
                  <summary className="cursor-pointer text-sm font-semibold">Record bank transfer</summary>
                  <form onSubmit={(event) => void recordPayment(invoice, event)} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium">Amount<input name="amount" required type="number" min="0.01" max={(invoice.balance_minor / 100).toFixed(2)} step="0.01" className="border-border bg-bg-primary mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm font-medium">Bank reference<input name="bankReference" maxLength={120} className="border-border bg-bg-primary mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm font-medium">Bank transaction date<input name="bankTransactionDate" type="date" className="border-border bg-bg-primary mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm font-medium">Unique statement transaction ID (optional)<input name="bankTransactionKey" maxLength={160} className="border-border bg-bg-primary mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <div className="sm:col-span-2"><button type="submit" disabled={busyId !== null} className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{busyId === invoice.id ? 'Recording…' : 'Reconcile payment'}</button></div>
                  </form>
                </details>
              )}
              {invoicePayments.length > 0 && (
                <div className="border-border mt-4 border-t pt-3">
                  <p className="text-sm font-semibold">Bank transactions</p>
                  <div className="mt-2 space-y-3">
                    {invoicePayments.map((transaction) => {
                      const refunded = refundsByPayment.get(transaction.id) ?? 0;
                      const refundable = transaction.transaction_type === 'payment' ? transaction.amount_minor - refunded : 0;
                      return (
                        <div key={transaction.id} className="rounded-lg bg-bg-secondary/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-medium">{humanize(transaction.transaction_type)} · {transaction.bank_reference || 'No bank reference'}</span>
                            <span className="font-semibold tabular-nums">{transaction.transaction_type === 'refund' ? '−' : ''}{money(transaction.amount_minor, transaction.currency)}</span>
                          </div>
                          <p className="text-text-muted mt-1 text-xs">{transaction.bank_transaction_date || new Date(transaction.received_at).toLocaleDateString('en-GB')} {transaction.transaction_type === 'payment' && refunded > 0 ? `· Refunded ${money(refunded, transaction.currency)}` : ''}</p>
                          {refundable > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-semibold">Record refund</summary>
                              <form onSubmit={(event) => void recordRefund(transaction, event)} className="mt-2 grid gap-2 sm:grid-cols-2">
                                <label className="text-xs font-medium">Refund amount<input name="amount" required type="number" min="0.01" max={(refundable / 100).toFixed(2)} step="0.01" className="border-border bg-bg-primary mt-1 w-full rounded-md border px-2 py-1.5" /></label>
                                <label className="text-xs font-medium">Bank reference<input name="bankReference" maxLength={120} className="border-border bg-bg-primary mt-1 w-full rounded-md border px-2 py-1.5" /></label>
                                <label className="text-xs font-medium">Refund date<input name="bankTransactionDate" type="date" className="border-border bg-bg-primary mt-1 w-full rounded-md border px-2 py-1.5" /></label>
                                <label className="text-xs font-medium">Statement transaction ID<input name="bankTransactionKey" maxLength={160} className="border-border bg-bg-primary mt-1 w-full rounded-md border px-2 py-1.5" /></label>
                                <div className="sm:col-span-2"><button type="submit" disabled={busyId !== null} className="border border-red-500/40 rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50">{busyId === transaction.id ? 'Recording…' : 'Record refund'}</button></div>
                              </form>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SponsorFinancialManager({
  sponsors,
  financialsBySponsor,
}: {
  sponsors: SponsorFinancialRecord[];
  financialsBySponsor: Record<string, SponsorFinancials>;
}) {
  if (sponsors.length === 0) return null;
  return (
    <div className="mt-10 space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Sponsor financials</h2>
        <p className="text-text-secondary mt-1 text-sm">
          Issue invoices, reconcile full or partial bank transfers, and record refunds. Transactions are append-only and never initiate a payment.
        </p>
      </div>
      {sponsors.map((sponsor) => (
        <SponsorFinancialCard
          key={sponsor.id}
          sponsor={sponsor}
          financials={financialsBySponsor[sponsor.id] ?? { invoices: [], transactions: [] }}
        />
      ))}
    </div>
  );
}
