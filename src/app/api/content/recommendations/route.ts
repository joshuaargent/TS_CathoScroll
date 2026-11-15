import { NextResponse } from 'next/server';

import { getRecommendationPage } from '@/lib/recommendations-server';
import { createClient } from '@/lib/supabase/server';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to load recommendations.' },
      { status: 401, headers }
    );
  }

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status, headers }
    );
  }
  const body = parsed.value;

  if (
    !body ||
    typeof body !== 'object' ||
    !('cursor' in body) ||
    typeof body.cursor !== 'string' ||
    !body.cursor ||
    body.cursor.length > 512
  ) {
    return NextResponse.json({ error: 'Invalid recommendation cursor.' }, { status: 400, headers });
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'recommendations:user',
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: rateLimit.unavailable ? 'Recommendations are temporarily unavailable.' : 'You have requested recommendations too frequently. Please try again shortly.' },
      {
        status: rateLimit.unavailable ? 503 : 429,
        headers: { ...headers, ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds) },
      }
    );
  }

  try {
    const page = await getRecommendationPage(supabase, body.cursor);
    return NextResponse.json(page, { headers });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '22023') {
      return NextResponse.json(
        { error: 'Invalid recommendation cursor.' },
        { status: 400, headers }
      );
    }
    console.error('Unable to load recommendations:', error);
    return NextResponse.json(
      { error: 'Unable to load recommendations. Please try again.' },
      { status: 500, headers }
    );
  }
}
