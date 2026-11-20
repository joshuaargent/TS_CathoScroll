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

export function isSameOriginOrNativeRequest(request: Request, allowAnonymousNative = false): boolean {
  if (isSameOrigin(request)) return true;
  return Boolean(
    nativeOrigin(request) &&
    (allowAnonymousNative || /^Bearer\s+\S+$/i.test(request.headers.get('authorization') ?? ''))
  );
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

export async function getAdminSessionFromRequest(request: Request) {
  const { supabase, user } = await getAuthenticatedUserFromRequest(request);
  if (!user) return { user: null, isAdmin: false, error: null };
  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { user, isAdmin: false, error: new Error(error.message) };
  return { user, isAdmin: Boolean(data), error: null };
}

export async function getAdminSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false, error: null };

  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { user, isAdmin: false, error: new Error(error.message) };
  return { user, isAdmin: Boolean(data), error: null };
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
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');

  if (origin !== null) return origin === requestOrigin;
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;

  const referer = request.headers.get('referer');
  if (!referer) return false;

  try {
    return new URL(referer).origin === requestOrigin;
  } catch {
    return false;
  }
}

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user, accessToken: undefined };
}
