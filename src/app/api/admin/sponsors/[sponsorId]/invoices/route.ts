import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import { createServiceRoleClient, getAdminSessionFromRequest, isSameOriginOrNativeRequest, isValidUuid, nativeApiCorsHeaders } from '@/lib/supabase/admin';

interface RouteContext { params: Promise<{ sponsorId: string }> }

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function amountMinor(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000000 ? amount : null;
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
  if (mfaRequired) return respond(request, { error: 'Complete administrator MFA before managing invoices.' }, 403);
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const limit = await checkApiRateLimit({ scope: 'admin:sponsor-financials:write', identifier: user.id, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return respond(request, { error: limit.unavailable ? 'Financial management is temporarily unavailable.' : 'Too many financial changes. Please wait.' }, limit.unavailable ? 503 : 429, rateLimitResponseHeaders(limit.retryAfterSeconds));

  const { sponsorId } = await params;
  if (!isValidUuid(sponsorId)) return respond(request, { error: 'Invalid sponsor id.' }, 400);
  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid invoice details.' }, 400);

  const description = typeof parsed.value.description === 'string' ? parsed.value.description.trim() : '';
  const amount = amountMinor(parsed.value.amount);
  const currency = parsed.value.currency;
  const issuedOn = validDate(parsed.value.issuedOn);
  const dueOn = validDate(parsed.value.dueOn);
  const issueNow = parsed.value.issueNow;
  if (description.length < 2 || description.length > 500 || amount === null ||
      typeof currency !== 'string' || !['GBP', 'EUR', 'USD'].includes(currency) ||
      !issuedOn || !dueOn || dueOn < issuedOn || typeof issueNow !== 'boolean') {
    return respond(request, { error: 'Enter a valid description, amount, currency and invoice dates.' }, 400);
  }

  try {
    const client = createServiceRoleClient();
    const { data, error: rpcError } = await client.rpc('admin_create_sponsor_invoice', {
      p_actor_user_id: user.id, p_sponsor_id: sponsorId, p_description: description,
      p_amount_minor: amount, p_currency: currency, p_issued_on: issuedOn,
      p_due_on: dueOn, p_issue_now: issueNow,
    });
    if (rpcError) {
      if (rpcError.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (rpcError.code === '22023') return respond(request, { error: 'Invoice details are invalid.' }, 400);
      console.error('Unable to create sponsor invoice:', rpcError.message);
      return respond(request, { error: 'Unable to create invoice.' }, 500);
    }
    return respond(request, { invoice: data }, 201);
  } catch (cause) {
    console.error('Sponsor invoice creation failed:', cause);
    return respond(request, { error: 'Financial management is temporarily unavailable.' }, 503);
  }
}
