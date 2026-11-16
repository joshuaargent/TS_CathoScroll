import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

const nativeOrigins = new Set(['capacitor://localhost', 'capacitor-electron://localhost', 'http://localhost', 'https://localhost']);

function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  return origin && nativeOrigins.has(origin) ? origin : null;
}

export function nativeApiCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = nativeOrigin(request);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

export function isSameOriginOrNativeRequest(request: Request): boolean {
  if (isSameOrigin(request)) return true;
  return Boolean(nativeOrigin(request) && /^Bearer\s+\S+$/i.test(request.headers.get('authorization') ?? ''));
}

export async function getAuthenticatedUserFromRequest(request: Request) {
  const authorization = request.headers.get('authorization');
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token) return getAuthenticatedUser();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase authentication configuration is missing.');
  }

  const supabase = createSupabaseClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return { supabase, user: null, accessToken: token };
  return { supabase, user: data.user, accessToken: token };
}

export function hasTotpAssuranceInAccessToken(accessToken: string): boolean {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      aal?: unknown;
      amr?: unknown;
    };
    return (
      claims.aal === 'aal2' &&
      Array.isArray(claims.amr) &&
      claims.amr.some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'method' in entry &&
          entry.method === 'totp'
      )
    );
  } catch {
    return false;
  }
}

async function adminMfaSatisfied(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  accessToken?: string
) {
  const serviceClient = createServiceRoleClient();
  const { data: enforced, error: enforcementError } = await serviceClient.rpc(
    'admin_mfa_enforcement_enabled'
  );
  if (enforcementError) throw new Error(enforcementError.message);
  if (enforced !== true) return true;

  let verifiedAccessToken = accessToken;
  if (!verifiedAccessToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error(sessionError.message);
    verifiedAccessToken = sessionData.session?.access_token;
  }
  if (!verifiedAccessToken || !hasTotpAssuranceInAccessToken(verifiedAccessToken)) {
    return false;
  }

  const { data: hasVerifiedTotp, error: factorError } = await serviceClient.rpc(
    'admin_user_has_verified_totp',
    { p_user_id: userId }
  );
  if (factorError) throw new Error(factorError.message);
  return hasVerifiedTotp === true;
}

export async function getAdminSessionFromRequest(request: Request) {
  const { supabase, user, accessToken } = await getAuthenticatedUserFromRequest(request);
  if (!user) return { user: null, isAdmin: false, error: null, mfaRequired: false };
  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return { user, isAdmin: false, error: new Error(error.message), mfaRequired: false };
  }
  if (!data) {
    return { user, isAdmin: false, error: null, mfaRequired: false };
  }

  try {
    const mfaSatisfied = await adminMfaSatisfied(supabase, user.id, accessToken);
    return {
      user,
      isAdmin: mfaSatisfied,
      error: null,
      mfaRequired: !mfaSatisfied,
    };
  } catch (mfaError) {
    return {
      user,
      isAdmin: false,
      error: mfaError instanceof Error ? mfaError : new Error('Unable to verify administrator MFA'),
      mfaRequired: false,
    };
  }
}

export async function getAdminSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAdmin: false, error: null, mfaRequired: false };
  }

  // Resolve the role from the protected database table on every privileged
  // request; client-side visibility checks are only presentation, not auth.
  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return { user, isAdmin: false, error: new Error(error.message), mfaRequired: false };
  }
  if (!data) {
    return { user, isAdmin: false, error: null, mfaRequired: false };
  }

  try {
    const mfaSatisfied = await adminMfaSatisfied(supabase, user.id);
    return {
      user,
      isAdmin: mfaSatisfied,
      error: null,
      mfaRequired: !mfaSatisfied,
    };
  } catch (mfaError) {
    return {
      user,
      isAdmin: false,
      error: mfaError instanceof Error ? mfaError : new Error('Unable to verify administrator MFA'),
      mfaRequired: false,
    };
  }
}

export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service-role configuration is missing.');
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function isValidUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');

  return origin !== null && origin === new URL(request.url).origin;
}

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user, accessToken: undefined };
}
