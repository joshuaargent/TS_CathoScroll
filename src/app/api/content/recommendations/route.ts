import { NextResponse } from 'next/server';

import { getRecommendationPage } from '@/lib/recommendations-server';
import { getAuthenticatedUserFromRequest, isSameOriginOrNativeRequest, nativeApiCorsHeaders } from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

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
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }
  const { supabase, user } = await getAuthenticatedUserFromRequest(request);

  if (!user) {
    return respond(request, { error: 'Sign in to load recommendations.' }, 401);
  }

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) {
    return respond(request, { error: parsed.error }, parsed.status);
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
    return respond(request, { error: 'Invalid recommendation cursor.' }, 400);
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'recommendations:user',
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(request, { error: rateLimit.unavailable ? 'Recommendations are temporarily unavailable.' : 'You have requested recommendations too frequently. Please try again shortly.' }, rateLimit.unavailable ? 503 : 429, rateLimitResponseHeaders(rateLimit.retryAfterSeconds));
  }

  try {
    const page = await getRecommendationPage(supabase, body.cursor);
    return respond(request, page);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '22023') {
      return respond(request, { error: 'Invalid recommendation cursor.' }, 400);
    }
    console.error('Unable to load recommendations:', error);
    return respond(request, { error: 'Unable to load recommendations. Please try again.' }, 500);
  }
}
