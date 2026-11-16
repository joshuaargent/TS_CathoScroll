import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import { createServiceRoleClient, getAdminSessionFromRequest, isSameOriginOrNativeRequest, isValidUuid, nativeApiCorsHeaders } from '@/lib/supabase/admin';

interface RouteContext { params: Promise<{ sponsorId: string; paymentId: string }> }
function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function amountMinor(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\\d{0,8})(\\.\\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000000 ? amount : null;
}
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) return undefined;
  return value.trim() || null;
}
function validDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}
export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const { user, isAdmin, error, mfaRequired } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required.' }, 401);
  if (error) return respond(request, { error: 'Unable to verify administrator access.' }, 500);
  if (mfaRequired) return respond(request, { error: 'Complete administrator MFA before recording refunds.' }, 403);
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);
  const limit = await checkApiRateLimit({ scope: 'admin:sponsor-financials:write', identifier: user.id, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return respond(request, { error: limit.unavailable ? 'Financial management is temporarily unavailable.' : 'Too many financial changes. Please wait.' }, limit.unavailable ? 503 : 429, rateLimitResponseHeaders(limit.retryAfterSeconds));

  const { sponsorId, paymentId } = await params;
  if (!isValidUuid(sponsorId) || !isValidUuid(paymentId)) return respond(request, { error: 'Invalid sponsor or payment id.' }, 400);
  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid refund details.' }, 400);

  const amount = amountMinor(parsed.value.amount);
  const bankReference = optionalText(parsed.value.bankReference, 120);
  const bankTransactionKey = optionalText(parsed.value.bankTransactionKey, 160);
  const bankTransactionDate = validDate(parsed.value.bankTransactionDate);
  if (amount === null || bankReference === undefined || bankTransactionKey === undefined ||
      (parsed.value.bankTransactionDate !== undefined && parsed.value.bankTransactionDate !== null && parsed.value.bankTransactionDate !== '' && !bankTransactionDate)) {
    return respond(request, { error: 'Enter a valid refund amount and bank-transfer reference.' }, 400);
  }

  try {
    const client = createServiceRoleClient();
    const { data: financials, error: lookupError } = await client.rpc('get_admin_sponsor_financials', {
      p_actor_user_id: user.id,
      p_sponsor_id: sponsorId,
    });
    if (lookupError) {
      console.error('Unable to verify original sponsor payment:', lookupError.message);
      return respond(request, { error: 'Unable to verify original payment.' }, 503);
    }
    const recordedTransactions = isRecord(financials) && Array.isArray(financials.transactions)
      ? financials.transactions
      : [];
    const originalPayment = recordedTransactions.find((transaction) =>
      isRecord(transaction) && transaction.id === paymentId && transaction.transaction_type === 'payment'
    );
    if (!originalPayment) return respond(request, { error: 'Original payment not found for this sponsor.' }, 404);

    const { data, error: rpcError } = await client.rpc('admin_record_sponsor_refund', {
      p_actor_user_id: user.id, p_payment_id: paymentId, p_amount_minor: amount,
      p_bank_reference: bankReference, p_bank_transaction_date: bankTransactionDate,
      p_bank_transaction_key: bankTransactionKey,
    });
    if (rpcError) {
      if (rpcError.code === 'P0002') return respond(request, { error: 'Original payment not found.' }, 404);
      if (rpcError.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (rpcError.code === '23505') return respond(request, { error: 'That bank transaction has already been recorded.' }, 409);
      if (rpcError.code === '23514') return respond(request, { error: rpcError.message }, 409);
      if (rpcError.code === '22023') return respond(request, { error: 'Refund details are invalid.' }, 400);
      console.error('Unable to record sponsor refund:', rpcError.message);
      return respond(request, { error: 'Unable to record refund.' }, 500);
    }
    return respond(request, { refund: data });
  } catch (cause) {
    console.error('Sponsor refund recording failed:', cause);
    return respond(request, { error: 'Financial management is temporarily unavailable.' }, 503);
  }
}
