import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { getStoredAnalyticsConsent } from '@/lib/analytics-consent-server';
import { checkApiRateLimit, getTrustedClientIp, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  isValidUuid,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

function safeHttpsUrl(value: unknown, optional = false): value is string | null {
  if (optional && (value === null || value === undefined)) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCampaign(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const campaign = value as Record<string, unknown>;
  return (
    isValidUuid(campaign.campaign_id) &&
    typeof campaign.sponsor_name === 'string' &&
    campaign.sponsor_name.length > 0 &&
    campaign.sponsor_name.length <= 120 &&
    typeof campaign.campaign_name === 'string' &&
    campaign.campaign_name.length > 0 &&
    campaign.campaign_name.length <= 120 &&
    typeof campaign.headline === 'string' &&
    campaign.headline.length > 0 &&
    campaign.headline.length <= 100 &&
    typeof campaign.body === 'string' &&
    campaign.body.length > 0 &&
    campaign.body.length <= 500 &&
    (campaign.image_url === null || safeHttpsUrl(campaign.image_url)) &&
    safeHttpsUrl(campaign.destination_url) &&
    typeof campaign.cta_label === 'string' &&
    campaign.cta_label.length > 0 &&
    campaign.cta_label.length <= 32 &&
    campaign.disclosure === 'Sponsored'
  );
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request, true)) return respond(request, { error: 'Forbidden' }, 403);

  let auth: Awaited<ReturnType<typeof getAuthenticatedUserFromRequest>>;
  try {
    auth = await getAuthenticatedUserFromRequest(request);
  } catch (cause) {
    console.error('Unable to verify sponsor-feed authentication:', cause);
    return respond(request, { error: 'Authentication is temporarily unavailable.' }, 503);
  }
  const isAnonymous = !auth.user;

  const rateLimit = await checkApiRateLimit({
    scope: 'sponsor-campaigns:serve',
    identifier: auth.user?.id ?? `anonymous:${getTrustedClientIp(request) ?? 'unknown'}`,
    limit: 12,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Sponsored content is temporarily unavailable.' : 'Too many sponsored-content requests.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    !('sessionId' in parsed.value) ||
    (parsed.value.sessionId !== null && !isValidUuid(parsed.value.sessionId)) ||
    !('categorySlug' in parsed.value) ||
    (parsed.value.categorySlug !== null &&
      (typeof parsed.value.categorySlug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.value.categorySlug))) ||
    !('topicId' in parsed.value) ||
    typeof parsed.value.topicId !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.value.topicId)
  ) {
    return respond(request, { error: 'Invalid sponsored-content request.' }, 400);
  }

  try {
    const sponsorMeasurementConsent = (parsed.value as Record<string, unknown>).sponsorMeasurementConsent === true;
    // Anonymous measurement is opt-in per browser. Older clients that do not
    // send the explicit flag fail closed while sponsor delivery remains enabled.
    let sponsorMeasurementEnabled = isAnonymous
      ? sponsorMeasurementConsent && parsed.value.sessionId !== null
      : parsed.value.sessionId !== null;
    if (auth.user) {
      try {
        const consent = await getStoredAnalyticsConsent(auth.user.id);
        sponsorMeasurementEnabled = consent.sponsorMeasurement && parsed.value.sessionId !== null;
      } catch (cause) {
        // Fail closed for measurement, but never suppress an otherwise eligible
        // sponsor placement because the optional consent service is unavailable.
        console.error('Unable to verify sponsor measurement consent; serving without measurement:', cause);
        sponsorMeasurementEnabled = false;
      }
    }
    const measurementSessionId: string | null = sponsorMeasurementEnabled && typeof parsed.value.sessionId === 'string'
      ? parsed.value.sessionId
      : null;
    const { data, error } = isAnonymous
      ? await createServiceRoleClient().rpc('get_anonymous_sponsor_campaigns', {
          p_session_token: measurementSessionId,
          p_category_slug: parsed.value.categorySlug,
          p_topic_id: parsed.value.topicId,
          p_limit: 1,
        })
      : await createServiceRoleClient().rpc('get_weighted_sponsor_campaigns', {
          p_user_id: auth.user!.id,
          p_session_id: measurementSessionId,
          p_category_slug: parsed.value.categorySlug,
          p_topic_id: parsed.value.topicId,
          p_limit: 1,
        });
    if (error) {
      console.error('Unable to select sponsor campaigns:', error.message);
      return respond(request, { error: 'Sponsored content is temporarily unavailable.' }, 503);
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      !('campaigns' in data) ||
      !Array.isArray(data.campaigns) ||
      data.campaigns.length > 1 ||
      !('generated_at' in data) ||
      typeof data.generated_at !== 'string' ||
      !Number.isFinite(Date.parse(data.generated_at)) ||
      !data.campaigns.every(isCampaign)
    ) {
      console.error('Sponsor campaign selector returned an invalid response.');
      return respond(request, { error: 'Sponsored content is temporarily unavailable.' }, 503);
    }

    return respond(request, { campaigns: data.campaigns, generated_at: data.generated_at });
  } catch (cause) {
    console.error('Sponsor campaign selection failed:', cause);
    return respond(request, { error: 'Sponsored content is temporarily unavailable.' }, 503);
  }
}
