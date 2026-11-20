import { NextResponse } from 'next/server';

import { getPublicGeneralTopicPage, type GeneralFeedCursor } from '@/lib/content';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import { nativeApiCorsHeaders } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const rateLimit = await checkTrustedIpRateLimit(request, 'general-feed:ip', 120, 60);
  if (rateLimit && !rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'The feed is temporarily unavailable.' : 'Too many feed requests.' },
      rateLimit.unavailable ? 503 : 429,
      {
        'Cache-Control': 'private, no-store',
        ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      }
    );
  }

  const parsed = await readBoundedJson(request, 8192);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status, { 'Cache-Control': 'private, no-store' });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return respond(request, { error: 'Invalid general-feed request.' }, 400, { 'Cache-Control': 'private, no-store' });
  }
  const cursor = 'cursor' in parsed.value ? parsed.value.cursor : null;
  if (cursor !== null && (
    typeof cursor !== 'object' || Array.isArray(cursor) ||
    JSON.stringify(cursor).length > 4096
  )) {
    return respond(request, { error: 'Invalid general-feed cursor.' }, 400, { 'Cache-Control': 'private, no-store' });
  }

  try {
    const page = await getPublicGeneralTopicPage(cursor as GeneralFeedCursor | null, 50);
    return respond(request, page, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    console.error('Unable to load analytics-ranked general feed:', error);
    return respond(
      request,
      { error: 'Unable to load the feed. Please try again.' },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }
}
