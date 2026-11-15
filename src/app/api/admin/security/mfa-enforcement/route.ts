import { NextResponse } from 'next/server';

import {
  createServiceRoleClient,
  getAuthenticatedUserFromRequest,
  isSameOrigin,
} from '@/lib/supabase/admin';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function respond(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers });
}

async function loadOwnerStatus(userId: string) {
  const serviceClient = createServiceRoleClient();
  const [{ data: isOwner, error: ownerError }, { data: enforced, error: enforcementError }] =
    await Promise.all([
      serviceClient.rpc('is_cathoscroll_admin_owner', { p_user_id: userId }),
      serviceClient.rpc('admin_mfa_enforcement_enabled'),
    ]);
  if (ownerError) throw new Error(ownerError.message);
  if (enforcementError) throw new Error(enforcementError.message);
  return { isOwner: isOwner === true, enforcementEnabled: enforced === true };
}

export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedUserFromRequest(request);
    if (!user) return respond({ error: 'Authentication required' }, 401);
    const status = await loadOwnerStatus(user.id);
    return respond(status);
  } catch (error) {
    console.error('Unable to load administrator MFA settings:', error);
    return respond({ error: 'Unable to load security settings.' }, 500);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return respond({ error: 'Forbidden' }, 403);

  try {
    const { supabase, user } = await getAuthenticatedUserFromRequest(request);
    if (!user) return respond({ error: 'Authentication required' }, 401);

    const rateLimit = await checkApiRateLimit({
      scope: 'admin:mfa:enable',
      identifier: user.id,
      limit: 5,
      windowSeconds: 600,
    });
    if (!rateLimit.allowed) {
      return respond(
        { error: rateLimit.unavailable ? 'Security settings are temporarily unavailable' : 'Too many security-setting requests. Please wait.' },
        rateLimit.unavailable ? 503 : 429,
        rateLimitResponseHeaders(rateLimit.retryAfterSeconds)
      );
    }

    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) {
      console.error('Unable to verify administrator MFA assurance:', assuranceError.message);
      return respond({ error: 'Unable to verify authenticator status.' }, 503);
    }
    if (assurance.currentLevel !== 'aal2') {
      return respond({ error: 'Verify your authenticator code before enabling enforcement.' }, 403);
    }

    const serviceClient = createServiceRoleClient();
    const { data: isOwner, error: ownerError } = await serviceClient.rpc(
      'is_cathoscroll_admin_owner',
      { p_user_id: user.id }
    );
    if (ownerError) {
      console.error('Unable to verify administrator owner:', ownerError.message);
      return respond({ error: 'Unable to verify owner permissions.' }, 503);
    }
    if (isOwner !== true) return respond({ error: 'Only the CathoScroll owner can enable administrator MFA enforcement.' }, 403);

    const { data, error } = await serviceClient.rpc('enable_admin_mfa_enforcement', {
      p_actor_user_id: user.id,
    });
    if (error) {
      if (error.code === '23514') return respond({ error: 'Verify a TOTP authenticator before enabling enforcement.' }, 409);
      if (error.code === '42501') return respond({ error: 'Only the CathoScroll owner can enable administrator MFA enforcement.' }, 403);
      console.error('Unable to enable administrator MFA enforcement:', error.message);
      return respond({ error: 'Unable to enable administrator MFA enforcement.' }, 500);
    }
    return respond({ enabled: data === true });
  } catch (error) {
    console.error('Unable to enable administrator MFA enforcement:', error);
    return respond({ error: 'Unable to enable administrator MFA enforcement.' }, 500);
  }
}
