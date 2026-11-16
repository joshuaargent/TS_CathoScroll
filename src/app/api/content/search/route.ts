import { NextResponse } from 'next/server';

import { searchPublishedTopics } from '@/lib/content';
import {
  checkApiRateLimit,
  getTrustedClientIp,
  rateLimitResponseHeaders,
} from '@/lib/security/api-rate-limit';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (query.length > 120) {
    return NextResponse.json({ error: 'Search query is too long.' }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const clientIp = getTrustedClientIp(request);
  if (process.env.VERCEL === '1' && !clientIp) {
    return NextResponse.json(
      { error: 'Search is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (clientIp) {
    const rateLimit = await checkApiRateLimit({
      scope: 'search:ip',
      identifier: clientIp,
      // Search fires as users type. Keep a generous per-IP ceiling so
      // shared networks and active users are not throttled during normal use.
      limit: 180,
      windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? 'Search is temporarily unavailable.' : 'Too many searches. Please wait before trying again.' },
        {
          status: rateLimit.unavailable ? 503 : 429,
          headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
        }
      );
    }
  }

  try {
    const results = await searchPublishedTopics(query, 30);
    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    console.error('Unable to search the public topic catalog:', error);
    return NextResponse.json(
      { error: 'Topic search is temporarily unavailable.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
