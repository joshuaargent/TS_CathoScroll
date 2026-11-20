import { NextResponse } from 'next/server';

import { getPublicGeneralTopicPage, type GeneralFeedCursor } from '@/lib/content';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

export const runtime = 'nodejs';

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
