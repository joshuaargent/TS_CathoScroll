import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { getStoredAnalyticsConsent } from '@/lib/analytics-consent-server';
import { checkApiRateLimit, getTrustedClientIp } from '@/lib/security/api-rate-limit';
import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function respond(request: Request, body: unknown, status = 200) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) return new NextResponse(null, { status: 403 });
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Catho-Expected-User-Id');
  return new NextResponse(null, { status: 204, headers });
}

async function authenticate(request: Request) {
  if (!isSameOriginOrNativeRequest(request, true)) return { response: respond(request, { error: 'Forbidden' }, 403) };
  try {
    const auth = await getAuthenticatedUserFromRequest(request);
    if (!auth.user) return { response: respond(request, { error: 'Authentication required.' }, 401) };
    const expectedUserId = request.headers.get('X-Catho-Expected-User-Id');
    if (expectedUserId && expectedUserId !== auth.user.id) {
      return { response: respond(request, { error: 'Account changed during consent synchronisation.' }, 409) };
    }
    return { user: auth.user };
  } catch (cause) {
    console.error('Unable to verify analytics-consent authentication:', cause);
    return { response: respond(request, { error: 'Authentication is temporarily unavailable.' }, 503) };
  }
}

export async function GET(request: Request) {
  const authenticated = await authenticate(request);
  if ('response' in authenticated) return authenticated.response;
  try {
    const consent = await getStoredAnalyticsConsent(authenticated.user.id);
    return respond(request, { consent });
  } catch (cause) {
    console.error('Unable to read analytics consent:', cause);
    return respond(request, { error: 'Analytics preferences are temporarily unavailable.' }, 503);
  }
}

export async function POST(request: Request) {
  const authenticated = await authenticate(request);
  if ('response' in authenticated) return authenticated.response;
  const rateLimit = await checkApiRateLimit({
    scope: 'analytics-consent:write',
    identifier: authenticated.user.id || getTrustedClientIp(request) || 'unknown',
    limit: 20,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return respond(request, { error: rateLimit.unavailable ? 'Preferences are temporarily unavailable.' : 'Too many preference updates.' },
      rateLimit.unavailable ? 503 : 429);
  }
  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) return respond(request, { error: parsed.error }, parsed.status);
  if (
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    !('serviceImprovement' in parsed.value) ||
    typeof parsed.value.serviceImprovement !== 'boolean' ||
    !('sponsorMeasurement' in parsed.value) ||
    typeof parsed.value.sponsorMeasurement !== 'boolean' ||
    !('version' in parsed.value) ||
    parsed.value.version !== 1
  ) return respond(request, { error: 'Invalid analytics consent preferences.' }, 400);

  const { data, error } = await createServiceRoleClient().rpc('set_user_analytics_consent', {
    p_user_id: authenticated.user.id,
    p_service_improvement: parsed.value.serviceImprovement,
    p_sponsor_measurement: parsed.value.sponsorMeasurement,
    p_consent_version: 1,
  });
  if (error) {
    if (error.message.includes('Turn off personalisation before disabling Service improvement analytics')) {
      return respond(request, { error: 'Turn off personalisation before disabling Service improvement analytics.' }, 409);
    }
    console.error('Unable to save analytics consent:', error.message);
    return respond(request, { error: 'Analytics preferences are temporarily unavailable.' }, 503);
  }
  if (typeof data !== 'object' || data === null) {
    return respond(request, { error: 'The analytics consent service returned an invalid response.' }, 503);
  }
  return respond(request, { consent: data });
}
