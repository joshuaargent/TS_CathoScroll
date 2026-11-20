import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ campaignId: string }>;
}

const campaignActions = ['approve', 'pause', 'resume', 'complete', 'reject'] as const;
type CampaignAction = (typeof campaignActions)[number];

function respond(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginOrNativeRequest(request)) return respond(request, { error: 'Forbidden' }, 403);

  const { user, isAdmin, error: roleError } = await getAdminSessionFromRequest(request);
  if (!user) return respond(request, { error: 'Authentication required' }, 401);
  if (roleError) {
    console.error('Unable to verify campaign-management access:', roleError.message);
    return respond(request, { error: 'Unable to verify administrator access.' }, 500);
  }
  if (!isAdmin) return respond(request, { error: 'Forbidden' }, 403);

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:sponsor-campaigns:write',
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(
      request,
      { error: rateLimit.unavailable ? 'Campaign management is temporarily unavailable.' : 'Too many campaign changes. Please wait.' },
      rateLimit.unavailable ? 503 : 429,
      rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
    );
  }

  const { campaignId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(campaignId)) {
    return respond(request, { error: 'Invalid campaign id.' }, 400);
  }

  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    !('action' in parsed.value) ||
    typeof parsed.value.action !== 'string' ||
    !campaignActions.includes(parsed.value.action as CampaignAction)
  ) {
    return respond(request, { error: 'Invalid campaign action.' }, 400);
  }

  try {
    const { data, error } = await createServiceRoleClient().rpc('admin_set_sponsor_campaign_status', {
      p_actor_user_id: user.id,
      p_campaign_id: campaignId,
      p_action: parsed.value.action,
    });
    if (error) {
      if (error.code === 'P0002') return respond(request, { error: 'Campaign not found.' }, 404);
      if (error.code === '42501') return respond(request, { error: 'Administrator access required.' }, 403);
      if (error.code === '23514') return respond(request, { error: error.message }, 409);
      if (error.code === '22023') return respond(request, { error: 'Invalid campaign action.' }, 400);
      console.error('Unable to update sponsor campaign:', error.message);
      return respond(request, { error: 'Unable to update campaign.' }, 500);
    }
    return respond(request, { campaign: data });
  } catch (cause) {
    console.error('Sponsor campaign update failed:', cause);
    return respond(request, { error: 'Campaign management is temporarily unavailable.' }, 500);
  }
}
