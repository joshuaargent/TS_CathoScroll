import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number, minimum = 0): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized || null : undefined;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validHttpsUrl(value: string | null | undefined, required = false): boolean {
  if (value === null) return !required;
  if (value === undefined) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validDate(value: unknown): string | null | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] | undefined {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (!items || items.length > maximumItems || items.some((item) => typeof item !== 'string')) {
    return undefined;
  }
  const normalized = items.map((item) => (item as string).trim()).filter(Boolean);
  if (normalized.some((item) => item.length > maximumLength) ||
      new Set(normalized).size !== normalized.length) return undefined;
  return normalized;
}

function positiveInteger(value: unknown, maximum: number): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : undefined;
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);

  const { user, isAdmin, error: roleError, mfaRequired } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (roleError) {
    console.error('Unable to verify campaign-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify administrator access.' }, 500);
  }
  if (mfaRequired) return respond(request, { error: 'Complete administrator MFA before managing campaigns.' }, 403);
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:sponsor-campaigns:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Campaign management is temporarily unavailable.' : 'Too many campaign changes. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const parsed = await readBoundedJson(request, 8192);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid campaign details.' }, 400);

  const body = parsed.value;
  const sponsorId = body.sponsorId;
  const campaignName = text(body.campaignName, 120, 2);
  const headline = text(body.headline, 100, 2);
  const description = text(body.body, 500, 2);
  const imageUrl = text(body.imageUrl, 2048);
  const destinationUrl = text(body.destinationUrl, 2048);
  const ctaLabel = text(body.ctaLabel, 32, 2);
  const startsOn = validDate(body.startsOn);
  const endsOn = validDate(body.endsOn);
  const categories = stringArray(body.targetCategorySlugs, 100, 150);
  const topics = stringArray(body.targetTopicIds, 500, 150);
  const weight = positiveInteger(body.placementWeight, 1000);
  const frequency24h = positiveInteger(body.frequencyCapPerUser24h, 25);
  const frequencyTotal = positiveInteger(body.frequencyCapPerUserTotal, 50);
  const dailyCap = positiveInteger(body.dailyImpressionCap, 1000000000);
  const totalCap = positiveInteger(body.totalImpressionCap, 100000000000);

  if (
    !uuid(sponsorId) ||
    campaignName === undefined || campaignName === null ||
    headline === undefined || headline === null ||
    description === undefined || description === null ||
    imageUrl === undefined || !validHttpsUrl(imageUrl) ||
    destinationUrl === undefined || destinationUrl === null || !validHttpsUrl(destinationUrl, true) ||
    ctaLabel === undefined ||
    startsOn === undefined || startsOn === null ||
    endsOn === undefined || endsOn === null || endsOn < startsOn ||
    categories === undefined || categories.some((slug) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) ||
    topics === undefined || topics.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) ||
    weight === undefined || weight === null ||
    frequency24h === undefined || frequency24h === null ||
    frequencyTotal === undefined || frequencyTotal === null ||
    dailyCap === undefined || totalCap === undefined
  ) {
    return respond(request, { error: 'One or more campaign fields are invalid.' }, 400);
  }

  try {
    const { data, error } = await createServiceRoleClient().rpc('admin_create_sponsor_campaign', {
      p_actor_user_id: user.id,
      p_sponsor_id: sponsorId,
      p_campaign_name: campaignName,
      p_headline: headline,
      p_body: description,
      p_image_url: imageUrl,
      p_destination_url: destinationUrl,
      p_cta_label: ctaLabel ?? 'Learn more',
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_target_category_slugs: categories,
      p_target_topic_ids: topics,
      p_placement_weight: weight,
      p_frequency_cap_per_user_24h: frequency24h,
      p_frequency_cap_per_user_total: frequencyTotal,
      p_daily_impression_cap: dailyCap,
      p_total_impression_cap: totalCap,
    });

    if (error) {
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === 'P0002') return respond(request, { error: 'Sponsor not found.' }, 404);
      if (error.code === '22023' || error.code === '23514') {
        return respond(request, { error: 'Campaign configuration or targeting is invalid.' }, 400);
      }
      console.error('Unable to create sponsor campaign:', error.message);
      return respond(request, { error: 'Unable to create campaign. No record was saved.' }, 500);
    }
    return respond(request, { campaign: data }, 201);
  } catch (cause) {
    console.error('Sponsor campaign creation failed:', cause);
    return respond(request, { error: 'Campaign management is temporarily unavailable.' }, 500);
  }
}
