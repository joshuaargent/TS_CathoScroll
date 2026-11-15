import { NextResponse } from 'next/server';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

import { loadCommentBanAppeals, loadCommentReports } from '@/lib/moderation/admin-data';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return respond(request, { error: 'Forbidden' }, 403);
  }

  let session: Awaited<ReturnType<typeof getAdminSessionFromRequest>>;
  try {
    session = await getAdminSessionFromRequest(request);
  } catch (error) {
    console.error('Unable to verify native admin access:', error);
    return respond(request, { error: 'Unable to verify admin access' }, 500);
  }

  const { user, isAdmin, error: roleError } = session;
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (roleError) {
    console.error('Unable to verify native admin role:', roleError.message);
    return respond(request, { error: 'Unable to verify admin access' }, 500);
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:moderation',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Administrator services are temporarily unavailable' : 'Too many administrator requests. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const url = new URL(request.url);
  const section = url.searchParams.get('section') ?? 'dashboard';
  const pageValue = Number(url.searchParams.get('page') ?? '0');
  if (
    !['dashboard', 'reports', 'appeals'].includes(section) ||
    !Number.isSafeInteger(pageValue) ||
    pageValue < 0 ||
    pageValue > 100000
  ) {
    return respond(request, { error: 'Invalid admin page request' }, 400);
  }

  let adminClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (error) {
    console.error('Native admin data is not configured:', error);
    return respond(request, { error: 'Admin data is not configured' }, 500);
  }

  try {
    if (section === 'dashboard') {
      const [{ items: reports }, { items: appeals }] = await Promise.all([
        loadCommentReports(adminClient, 0, 10),
        loadCommentBanAppeals(adminClient, 0, 10),
      ]);
      return respond(request, { adminUserId: user.id, reports, appeals });
    }

    const pageSize = 25;
    if (section === 'reports') {
      const result = await loadCommentReports(adminClient, pageValue * pageSize, pageSize);
      return respond(request, { adminUserId: user.id, ...result });
    }

    const result = await loadCommentBanAppeals(adminClient, pageValue * pageSize, pageSize);
    return respond(request, result);
  } catch (error) {
    console.error('Unable to load native moderation data:', error);
    return respond(request, { error: 'Unable to load moderation data' }, 500);
  }
}
