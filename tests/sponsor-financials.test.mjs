import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  bootstrap,
  invoiceRoute,
  paymentRoute,
  refundRoute,
  financialManager,
  sponsorPortal,
  sponsorPage,
] = await Promise.all([
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsors/[sponsorId]/invoices/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsors/[sponsorId]/invoices/[invoiceId]/payments/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsors/[sponsorId]/payments/[paymentId]/refunds/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/SponsorFinancialManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/sponsor/SponsorPortal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/sponsor/page.tsx', import.meta.url), 'utf8'),
]);

function functionBody(name) {
  const start = bootstrap.lastIndexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = bootstrap.indexOf('ALTER FUNCTION ', start);
  assert.notEqual(end, -1, `Missing ALTER FUNCTION after ${name}`);
  return bootstrap.slice(start, end);
}

test('invoice and payment ledger tables are private and append-only from clients', () => {
  assert.match(bootstrap, /CREATE TABLE catho_private\.sponsor_invoices/);
  assert.match(bootstrap, /CREATE TABLE catho_private\.sponsor_payment_transactions/);
  assert.match(bootstrap, /ALTER TABLE catho_private\.sponsor_invoices ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /ALTER TABLE catho_private\.sponsor_payment_transactions ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE catho_private\.sponsor_invoices FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE catho_private\.sponsor_payment_transactions FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /sponsor_payment_transactions_bank_key_idx/);
  assert.match(bootstrap, /refund_of_payment_id/);
});

test('invoice creation and payment reconciliation require administrators', () => {
  const createInvoice = functionBody('public.admin_create_sponsor_invoice');
  const recordPayment = functionBody('public.admin_record_sponsor_payment');
  const refundPayment = functionBody('public.admin_record_sponsor_refund');
  assert.match(createInvoice, /public\.admin_users/);
  assert.match(createInvoice, /sponsor\.invoice_created/);
  assert.match(recordPayment, /public\.admin_users/);
  assert.match(recordPayment, /v_balance_minor/);
  assert.match(recordPayment, /p_amount_minor > v_balance_minor/);
  assert.match(recordPayment, /ON CONFLICT DO NOTHING/);
  assert.match(recordPayment, /bank_transaction_key/);
  assert.match(recordPayment, /v_outstanding_invoice_minor/);
  assert.match(recordPayment, /payment_status = CASE/);
  assert.match(refundPayment, /public\.admin_users/);
  assert.match(refundPayment, /refund_of_payment_id/);
  assert.match(refundPayment, /v_refunded_minor/);
  assert.match(refundPayment, /v_outstanding_invoice_minor/);
});

test('sponsor financial reporting verifies membership and omits personal identifiers', () => {
  const adminFinancials = functionBody('public.get_admin_sponsor_financials');
  const sponsorFinancials = functionBody('public.get_sponsor_financials');
  assert.match(adminFinancials, /public\.admin_users/);
  assert.match(adminFinancials, /sponsor_payment_transactions/);
  assert.match(sponsorFinancials, /public\.sponsor_memberships/);
  assert.match(sponsorFinancials, /membership\.status = 'active'/);
  assert.match(sponsorFinancials, /'bank_reference'/);
  assert.doesNotMatch(sponsorFinancials, /'recorded_by'|'user_id'|'actor_user_id'/);
});

test('legacy direct payment status override is revoked and new sponsors cannot be marked paid on creation', () => {
  const legacyPaymentRevoke = bootstrap.lastIndexOf('REVOKE ALL ON FUNCTION public.admin_mark_sponsor_payment_received(uuid, uuid, text)');
  assert.notEqual(legacyPaymentRevoke, -1);
  assert.doesNotMatch(bootstrap.slice(legacyPaymentRevoke), /GRANT EXECUTE ON FUNCTION public\.admin_mark_sponsor_payment_received/);
  const createSponsor = functionBody('public.admin_create_sponsor');
  assert.match(createSponsor, /p_payment_status NOT IN \('pending', 'not_required'\)/);
  assert.match(createSponsor, /reconcile payments through an invoice/);
});

test('financial API routes enforce administrator, MFA, same-origin and rate limits', () => {
  for (const route of [invoiceRoute, paymentRoute, refundRoute]) {
    assert.match(route, /getAdminSessionFromRequest/);
    assert.match(route, /isSameOriginOrNativeRequest/);
    assert.match(route, /checkApiRateLimit/);
    assert.match(route, /readBoundedJson/);
  }
  assert.match(invoiceRoute, /admin_create_sponsor_invoice/);
  assert.match(paymentRoute, /admin_record_sponsor_payment/);
  assert.match(refundRoute, /admin_record_sponsor_refund/);
  assert.match(refundRoute, /get_admin_sponsor_financials/);
});

test('admin can issue invoices, reconcile partial transfers and record refunds', () => {
  assert.match(financialManager, /Create and issue invoice/);
  assert.match(financialManager, /Record bank transfer/);
  assert.match(financialManager, /Reconcile payment/);
  assert.match(financialManager, /Record refund/);
  assert.match(financialManager, /outstanding balance/);
  assert.match(financialManager, /bankTransactionKey/);
});

test('sponsor portal displays only its organisation invoice and payment history', () => {
  assert.match(sponsorPage, /get_sponsor_financials/);
  assert.match(sponsorPortal, /Invoices and payments/);
  assert.match(sponsorPortal, /Recorded bank transactions/);
  assert.match(sponsorPortal, /financialsBySponsor/);
  assert.match(sponsorPortal, /Individual user identities are never shared/);
});
