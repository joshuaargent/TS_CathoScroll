import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

type SponsorStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';
type PaymentStatus = 'pending' | 'received' | 'not_required' | 'refunded';
type Currency = 'GBP' | 'EUR' | 'USD';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length > maximumLength) return undefined;
  return normalized || null;
}

function validHttpsUrl(value: string | null | undefined): boolean {
  if (value === null) return true;
  if (value === undefined) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

const sponsorStatuses: SponsorStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed'];
const paymentStatuses: PaymentStatus[] = ['pending', 'received', 'not_required', 'refunded'];
const currencies: Currency[] = ['GBP', 'EUR', 'USD'];

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }

  const { user, isAdmin, error: roleError, mfaRequired } =
    await getAdminSessionFromRequest(request);

  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (roleError) {
    console.error('Unable to verify sponsor-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify administrator access' }, 500);
  }
  if (mfaRequired) {
    return respond(request, { error: 'Complete administrator MFA before managing sponsors.' }, 403);
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:sponsors:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      {
        error: rateLimit.unavailable
          ? 'Sponsor management is temporarily unavailable.'
          : 'Too many sponsor changes. Please wait before trying again.',
      },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const parsed = await readBoundedJson(request, 8192);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid sponsor details.' }, 400);

  const body = parsed.value;
  const sponsorName = optionalText(body.sponsorName, 120);
  const contactEmail = optionalText(body.contactEmail, 254);
  const websiteUrl = optionalText(body.websiteUrl, 2048);
  const logoUrl = optionalText(body.logoUrl, 2048);
  const description = optionalText(body.description, 500);
  const startsOn = validDate(body.startsOn);
  const endsOn = validDate(body.endsOn);
  const paymentReference = optionalText(body.paymentReference, 120);
  const adminNotes = optionalText(body.adminNotes, 2000);
  const amountInput = body.agreedAmount;
  const status = body.status;
  const paymentStatus = body.paymentStatus;
  const currency = body.currency;

  if (
    typeof sponsorName !== 'string' ||
    sponsorName.length < 2 ||
    contactEmail === undefined ||
    (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) ||
    websiteUrl === undefined ||
    !validHttpsUrl(websiteUrl) ||
    logoUrl === undefined ||
    !validHttpsUrl(logoUrl) ||
    description === undefined ||
    startsOn === undefined ||
    endsOn === undefined ||
    (startsOn !== null && endsOn !== null && endsOn < startsOn) ||
    paymentReference === undefined ||
    adminNotes === undefined ||
    typeof status !== 'string' ||
    !sponsorStatuses.includes(status as SponsorStatus) ||
    typeof paymentStatus !== 'string' ||
    !paymentStatuses.includes(paymentStatus as PaymentStatus) ||
    typeof currency !== 'string' ||
    !currencies.includes(currency as Currency)
  ) {
    return respond(request, { error: 'One or more sponsor fields are invalid.' }, 400);
  }

  let agreedAmountMinor: number | null = null;
  if (amountInput !== undefined && amountInput !== null && amountInput !== '') {
    if (
      typeof amountInput !== 'string' ||
      !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(amountInput)
    ) {
      return respond(request, { error: 'Enter a valid agreed amount with up to two decimal places.' }, 400);
    }
    agreedAmountMinor = Math.round(Number(amountInput) * 100);
    if (!Number.isSafeInteger(agreedAmountMinor) || agreedAmountMinor > 100000000000) {
      return respond(request, { error: 'The agreed amount is outside the supported range.' }, 400);
    }
  }

  try {
    const adminClient = createServiceRoleClient();
    const { data, error } = await adminClient.rpc('admin_create_sponsor', {
      p_actor_user_id: user.id,
      p_sponsor_name: sponsorName,
      p_contact_email: contactEmail,
      p_website_url: websiteUrl,
      p_logo_url: logoUrl,
      p_description: description ?? '',
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_status: status,
      p_agreed_amount_minor: agreedAmountMinor,
      p_currency: currency,
      p_payment_status: paymentStatus,
      p_payment_reference: paymentReference,
      p_admin_notes: adminNotes ?? '',
    });

    if (error) {
      console.error('Unable to create sponsor:', error.message);
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === '23514' || error.code === '22023') {
        return respond(request, { error: 'One or more sponsor fields are invalid.' }, 400);
      }
      return respond(request, { error: 'Unable to create sponsor. No record was saved.' }, 500);
    }

    return respond(request, { sponsor: data }, 201);
  } catch (cause) {
    console.error('Sponsor creation failed:', cause);
    return respond(request, { error: 'Sponsor management is temporarily unavailable.' }, 500);
  }
}
