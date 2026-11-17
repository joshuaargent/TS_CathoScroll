import { NextResponse } from 'next/server';

import { isTopFeedComment, toPublicTopFeedComment } from '@/lib/feed-comments';

import { createServiceRoleClient, nativeApiCorsHeaders } from '@/lib/supabase/admin';
import {
  checkTrustedIpRateLimit,
  rateLimitResponseHeaders,
} from '@/lib/security/api-rate-limit';

export const runtime = 'nodejs';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
};

function respond(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit
) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }

  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const rateLimit = await checkTrustedIpRateLimit(request, 'top-comments:ip', 120, 60);

  if (rateLimit && !rateLimit.allowed) {
    return respond(
      request,
      {
        error: rateLimit.unavailable
          ? 'Top comments are temporarily unavailable.'
          : 'Too many top-comment requests. Please wait.',
      },
      rateLimit.unavailable ? 503 : 429,
      {
        'Cache-Control': 'private, no-store',
        ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      }
    );
  }

  const requestUrl = new URL(request.url);
  const rawOffset = requestUrl.searchParams.get('offset') ?? '0';
  const rawLimit = requestUrl.searchParams.get('limit') ?? '100';
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return respond(request, { error: 'Invalid top-comment page.' }, 400, { 'Cache-Control': 'private, no-store' });
  }

  try {
    const { data, error } = await createServiceRoleClient().rpc('get_top_feed_comments', {
      p_offset: offset,
      p_limit: limit,
    });

    if (error) {
      console.error('Unable to load top feed comments:', error.message);
      return respond(
        request,
        { error: 'Top comments are temporarily unavailable.' },
        503,
        { 'Cache-Control': 'private, no-store' }
      );
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !('comments' in data) ||
      !Array.isArray(data.comments) ||
      data.comments.length > limit ||
      !('next_offset' in data) ||
      (data.next_offset !== null && (!Number.isSafeInteger(data.next_offset) || Number(data.next_offset) <= offset || Number(data.next_offset) > 5000)) ||
      !('generated_at' in data) ||
      typeof data.generated_at !== 'string' ||
      !Number.isFinite(Date.parse(data.generated_at))
    ) {
      console.error('Top-comment selection RPC returned an invalid response.');
      return respond(
        request,
        { error: 'Top comments are temporarily unavailable.' },
        503,
        { 'Cache-Control': 'private, no-store' }
      );
    }

    const validatedComments = data.comments.filter(isTopFeedComment);
    if (validatedComments.length !== data.comments.length) {
      console.error('Top-comment selection RPC returned an invalid comment entry.');
      return respond(
        request,
        { error: 'Top comments are temporarily unavailable.' },
        503,
        { 'Cache-Control': 'private, no-store' }
      );
    }

    // Explicitly allowlist public fields so a future RPC change cannot expose
    // user IDs or moderation metadata through this public endpoint.
    return respond(
      request,
      {
        comments: validatedComments.map(toPublicTopFeedComment),
        next_offset: data.next_offset === null ? null : data.next_offset,
        generated_at: data.generated_at,
      },
      200,
      cacheHeaders
    );
  } catch (error) {
    console.error('Unable to load top feed comments:', error);
    return respond(
      request,
      { error: 'Top comments are temporarily unavailable.' },
      503,
      { 'Cache-Control': 'private, no-store' }
    );
  }
}
