import { NextResponse } from 'next/server';

import { getRecommendationPage } from '@/lib/recommendations-server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';

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

  let rateLimitClient;
  try {
    rateLimitClient = createServiceRoleClient();
  } catch (error) {
    console.error('Recommendation rate limiting is not configured:', error);
    return NextResponse.json(
      { error: 'Recommendations are temporarily unavailable.' },
      { status: 503, headers }
    );
  }

  const { data: withinRateLimit, error: rateLimitError } = await rateLimitClient.rpc(
    'consume_recommendation_rate_limit',
    { p_user_id: user.id }
  );
  if (rateLimitError) {
    console.error('Unable to enforce recommendation rate limit:', rateLimitError.message);
    return NextResponse.json(
      { error: 'Recommendations are temporarily unavailable.' },
      { status: 503, headers }
    );
  }
  if (withinRateLimit !== true) {
    return NextResponse.json(
      { error: 'You have requested recommendations too frequently. Please try again in a minute.' },
      { status: 429, headers: { ...headers, 'Retry-After': '60' } }
    );
  }

  if (!body || typeof body !== 'object' || !('cursor' in body) || !body.cursor) {
    return NextResponse.json({ error: 'Invalid recommendation cursor.' }, { status: 400, headers });
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
