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

const anonymousEventTypes = ['served', 'viewable_impression', 'click', 'active_duration'] as const;
const accountEventTypes = ['viewable_impression', 'click', 'active_duration'] as const;

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
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
    console.error('Unable to verify sponsor-event authentication:', cause);
    return respond(request, { error: 'Authentication is temporarily unavailable.' }, 503);
  }

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return respond(request, { error: 'Invalid sponsor event.' }, 400);
  }

  const payload = parsed.value as Record<string, unknown>;
  const measurementScope = payload.measurementScope;
  const isAnonymous = measurementScope === 'anonymous' || (!auth.user && measurementScope !== 'account');
  if (measurementScope !== undefined && measurementScope !== 'anonymous' && measurementScope !== 'account') {
    return respond(request, { error: 'Invalid sponsor measurement scope.' }, 400);
  }
  if (!isAnonymous && !auth.user) {
    return respond(request, { error: 'Sign in to record account-linked sponsor measurement.' }, 401);
  }

  const campaignId = payload.campaignId;
  const eventId = payload.eventId;
  const placementReceipt = payload.placementReceipt;
  const eventType = payload.eventType;
  const sessionId = payload.sessionId;
  const durationMs = payload.durationMs;
  const frequencyIndex = payload.frequencyIndex;

  if (
    !isValidUuid(campaignId) ||
    !isValidUuid(eventId) ||
    !isValidUuid(placementReceipt) ||
    typeof eventType !== 'string' ||
    !(isAnonymous
      ? anonymousEventTypes.includes(eventType as (typeof anonymousEventTypes)[number])
      : accountEventTypes.includes(eventType as (typeof accountEventTypes)[number])) ||
    (!isAnonymous && !isValidUuid(sessionId)) ||
    (eventType === 'active_duration'
      ? !Number.isSafeInteger(durationMs) || Number(durationMs) < 1 || Number(durationMs) > 60000
      : durationMs !== undefined) ||
    (isAnonymous && eventType === 'served'
      ? !Number.isSafeInteger(frequencyIndex) || Number(frequencyIndex) < 1 || Number(frequencyIndex) > 100
      : frequencyIndex !== undefined)
  ) {
    return respond(request, { error: 'Invalid sponsor event.' }, 400);
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'sponsor-campaign-events:write',
    identifier: isAnonymous
      ? `anonymous:${getTrustedClientIp(request) ?? 'unknown'}`
      : auth.user!.id,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Sponsor analytics are temporarily unavailable.' : 'Too many sponsor events.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  try {
    if (!isAnonymous) {
      const consent = await getStoredAnalyticsConsent(auth.user!.id);
      if (!consent.sponsorMeasurement) {
        return respond(request, {
          error: 'Sponsor measurement consent is not active.',
          code: 'CONSENT_REQUIRED',
        }, 403);
      }
    }

    const { data, error } = isAnonymous
      ? await createServiceRoleClient().rpc('record_anonymous_sponsor_campaign_event', {
          p_campaign_id: campaignId,
          p_placement_receipt: placementReceipt,
          p_event_id: eventId,
          p_event_type: eventType,
          p_duration_ms: eventType === 'active_duration' ? durationMs : 0,
          p_frequency_index: eventType === 'served' ? frequencyIndex : 0,
        })
      : await createServiceRoleClient().rpc('record_sponsor_campaign_event', {
          p_user_id: auth.user!.id,
          p_campaign_id: campaignId,
          p_event_id: eventId,
          p_session_id: sessionId,
          p_event_type: eventType,
          p_duration_ms: eventType === 'active_duration' ? durationMs : 0,
          p_placement_receipt: placementReceipt,
        });

    if (error) {
      if (error.code === '42501') return respond(request, { error: 'Sponsor placement was not eligible.' }, 403);
      if (error.code === '22023') return respond(request, { error: 'Invalid sponsor event.' }, 400);
      console.error('Unable to record sponsor event:', error.message);
      return respond(request, { error: 'Sponsor analytics are temporarily unavailable.' }, 503);
    }
    return respond(request, { recorded: data === true });
  } catch (cause) {
    console.error('Sponsor event recording failed:', cause);
    return respond(request, { error: 'Sponsor analytics are temporarily unavailable.' }, 503);
  }
}
