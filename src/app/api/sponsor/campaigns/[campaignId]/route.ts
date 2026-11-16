import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  isValidUuid,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ campaignId: string }>;
}

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

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function safeHttpsUrl(value: string | null | undefined, required = false): boolean {
  if (value === null) return !required;
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] | undefined {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!items || items.length > maximumItems || items.some((item) => typeof item !== 'string')) return undefined;
  const normalized = items.map((item) => (item as string).trim()).filter(Boolean);
  if (normalized.some((item) => item.length > maximumLength) || new Set(normalized).size !== normalized.length) {
    return undefined;
  }
  return normalized;
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const { user } = await getAuthenticatedUserFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required.' }, 401);

  const rateLimit = await checkApiRateLimit({
    scope: 'sponsor:campaigns:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Sponsor campaign management is temporarily unavailable.' : 'Too many campaign changes. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const { campaignId } = await params;
  if (!isValidUuid(campaignId)) return respond(request, { error: 'Invalid campaign id.' }, 400);
  const parsed = await readBoundedJson(request, 8192);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!isRecord(parsed.value)) return respond(request, { error: 'Invalid campaign details.' }, 400);

  const body = parsed.value;
  const campaignName = text(body.campaignName, 120, 2);
  const headline = text(body.headline, 100, 2);
  const campaignBody = text(body.body, 500, 2);
  const imageUrl = text(body.imageUrl, 2048);
  const destinationUrl = text(body.destinationUrl, 2048, 1);
  const ctaLabel = text(body.ctaLabel, 32, 2);
  const startsOn = validDate(body.startsOn);
  const endsOn = validDate(body.endsOn);
  const targetCategorySlugs = stringArray(body.targetCategorySlugs, 100, 120);
  const targetTopicIds = stringArray(body.targetTopicIds, 500, 120);

  if (
    campaignName === undefined || campaignName === null ||
    headline === undefined || headline === null ||
    campaignBody === undefined || campaignBody === null ||
    imageUrl === undefined ||
    destinationUrl === undefined || destinationUrl === null ||
    !safeHttpsUrl(imageUrl) || !safeHttpsUrl(destinationUrl, true) ||
    ctaLabel === undefined ||
    !startsOn || !endsOn || endsOn < startsOn ||
    !targetCategorySlugs || !targetTopicIds
  ) {
    return respond(request, { error: 'One or more campaign fields are invalid.' }, 400);
  }

  try {
    const adminClient = createServiceRoleClient();
    const { data, error } = await adminClient.rpc('sponsor_update_campaign', {
      p_actor_user_id: user.id,
      p_campaign_id: campaignId,
      p_campaign_name: campaignName,
      p_headline: headline,
      p_body: campaignBody,
      p_image_url: imageUrl,
      p_destination_url: destinationUrl,
      p_cta_label: ctaLabel ?? 'Learn more',
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_target_category_slugs: targetCategorySlugs,
      p_target_topic_ids: targetTopicIds,
      p_placement_weight: 1,
      p_frequency_cap_per_user_24h: 1,
      p_frequency_cap_per_user_total: 3,
      p_daily_impression_cap: null,
      p_total_impression_cap: null,
    });
    if (error) {
      if (error.code === 'P0002') return respond(request, { error: 'Campaign not found.' }, 404);
      if (error.code === '42501') return respond(request, { error: 'You do not have permission to edit this campaign.' }, 403);
      if (error.code === '23514') return respond(request, { error: 'Approved campaigns cannot be edited by sponsor accounts. Contact CathoScroll to request a change.' }, 409);
      if (error.code === '22023') return respond(request, { error: 'Campaign details or targeting values are invalid.' }, 400);
      console.error('Unable to update sponsor campaign:', error.message);
      return respond(request, { error: 'Unable to update campaign.' }, 500);
    }
    return respond(request, { campaign: data });
  } catch (cause) {
    console.error('Sponsor campaign update failed:', cause);
    return respond(request, { error: 'Sponsor campaign management is temporarily unavailable.' }, 503);
  }
}
