import { NextResponse } from 'next/server';
import { nativeApiCorsHeaders } from '@/lib/supabase/admin';

import { getPublicGeneralTopicPage, type GeneralFeedCursor } from '@/lib/content';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

export const runtime = 'nodejs';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return respond(request, body, { status, headers });
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
    return NextResponse.json(
      { error: rateLimit.unavailable ? 'The feed is temporarily unavailable.' : 'Too many feed requests.' },
      { status: rateLimit.unavailable ? 503 : 429, headers: {
        'Cache-Control': 'private, no-store',
        ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      } }
    );
  }

  const parsed = await readBoundedJson(request, 8192);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: 'Invalid general-feed request.' }, { status: 400 });
  }
  const cursor = 'cursor' in parsed.value ? parsed.value.cursor : null;
  if (cursor !== null && (
    typeof cursor !== 'object' || Array.isArray(cursor) ||
    JSON.stringify(cursor).length > 4096
  )) {
    return NextResponse.json({ error: 'Invalid general-feed cursor.' }, { status: 400 });
  }

  try {
    const page = await getPublicGeneralTopicPage(cursor as GeneralFeedCursor | null, 50);
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Unable to load analytics-ranked general feed:', error);
    return NextResponse.json(
      { error: 'Unable to load the feed. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
