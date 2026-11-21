import { NextResponse } from 'next/server';

import { getAuthenticatedUserFromRequest, isSameOriginOrNativeRequest, nativeApiCorsHeaders } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import { getStoredAnalyticsConsent } from '@/lib/analytics-consent-server';

export const runtime = 'nodejs';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);
  const { supabase, user } = await getAuthenticatedUserFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required.' }, 401);
  try {
    const consent = await getStoredAnalyticsConsent(user.id);
    if (!consent.serviceImprovement) return respond(request, { error: 'Service improvement analytics consent is not active.', code: 'CONSENT_REQUIRED' }, 403);
  } catch (cause) {
    console.error('Unable to verify feed-card analytics consent:', cause);
    return respond(request, { error: 'Analytics preferences are temporarily unavailable.' }, 503);
  }
  const parsed = await readBoundedJson(request, 16384);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || !('events' in parsed.value) ||
      !Array.isArray(parsed.value.events) || parsed.value.events.length < 1 || parsed.value.events.length > 50) {
    return respond(request, { error: 'Invalid analytics batch.' }, 400);
  }
  const rateLimit = await checkApiRateLimit({ scope: 'feed-card-analytics:user', identifier: user.id, limit: 120, windowSeconds: 60 });
  if (!rateLimit.allowed) {
    return respond(request, { error: rateLimit.unavailable ? 'Analytics are temporarily unavailable.' : 'Too many analytics events.',
      }, rateLimit.unavailable ? 503 : 429, rateLimitResponseHeaders(rateLimit.retryAfterSeconds));
  }
  const { data, error } = await supabase.rpc('record_feed_card_analytics_events', { p_events: parsed.value.events });
  if (error) {
    if (error.code === '42501') return respond(request, { error: 'Authentication required.' }, 401);
    if (error.code === '22023') return respond(request, { error: 'Invalid analytics event batch.' }, 400);
    console.error('Unable to record feed-card analytics:', error.message);
    return respond(request, { error: 'Unable to record analytics.' }, 503);
  }
  if (data === -1) return respond(request, { error: 'Analytics event rate limit exceeded.' }, 429, rateLimitResponseHeaders(60));
  if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0 || data > 50) {
    return respond(request, { error: 'Analytics service returned an invalid response.' }, 503);
  }
  return respond(request, { accepted: data });
}
