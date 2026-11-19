import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, getTrustedClientIp, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import { createServiceRoleClient, isSameOriginOrNativeRequest, nativeApiCorsHeaders } from '@/lib/supabase/admin';

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
  if (!isSameOriginOrNativeRequest(request, true)) return respond(request, { error: 'Forbidden' }, 403);
  const parsed = await readBoundedJson(request, 16384);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || !('events' in parsed.value) ||
      !Array.isArray(parsed.value.events) || parsed.value.events.length < 1 || parsed.value.events.length > 40) {
    return respond(request, { error: 'Invalid anonymous analytics batch.' }, 400);
  }
  const address = getTrustedClientIp(request) ?? 'unknown';
  const rateLimit = await checkApiRateLimit({
    scope: 'anonymous-feed-analytics:write',
    identifier: address,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(request, { error: rateLimit.unavailable ? 'Analytics are temporarily unavailable.' : 'Too many analytics events.' },
      rateLimit.unavailable ? 503 : 429, rateLimitResponseHeaders(rateLimit.retryAfterSeconds));
  }
  const { data, error } = await createServiceRoleClient().rpc('record_anonymous_feed_analytics', {
    p_events: parsed.value.events,
  });
  if (error) {
    if (error.code === '22023') return respond(request, { error: 'Invalid anonymous analytics event batch.' }, 400);
    console.error('Unable to record anonymous analytics:', error.message);
    return respond(request, { error: 'Unable to record analytics.' }, 503);
  }
  if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0 || data > 40) {
    return respond(request, { error: 'Analytics service returned an invalid response.' }, 503);
  }
  return respond(request, { accepted: data });
}
