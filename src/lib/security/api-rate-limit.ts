import 'server-only';

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { createServiceRoleClient } from '@/lib/supabase/admin';

export interface ApiRateLimit {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}

export type ApiRateLimitResult =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number; unavailable?: false }
  | { allowed: false; retryAfterSeconds: number; unavailable: true };

/**
 * Uses a shared Postgres counter, not process memory. The SQL RPC serializes
 * concurrent requests on the counter row and is executable only by service_role.
 */
export async function checkApiRateLimit({
  scope,
  identifier,
  limit,
  windowSeconds,
}: ApiRateLimit): Promise<ApiRateLimitResult> {
  if (
    !/^[a-z][a-z0-9:_-]{0,63}$/i.test(scope) ||
    !identifier ||
    identifier.length > 512 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds < 1
  ) {
    return { allowed: false, retryAfterSeconds: 60, unavailable: true };
  }

  const keyHash = createHash('sha256')
    .update(`${scope}\0${identifier}`, 'utf8')
    .digest('hex');

  try {
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc('consume_api_rate_limit', {
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error('Unable to enforce API rate limit:', error.message);
      return { allowed: false, retryAfterSeconds: 60, unavailable: true };
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (
      !result ||
      typeof result !== 'object' ||
      !('allowed' in result) ||
      typeof result.allowed !== 'boolean' ||
      !('retry_after_seconds' in result) ||
      typeof result.retry_after_seconds !== 'number'
    ) {
      console.error('API rate-limit RPC returned an invalid response.');
      return { allowed: false, retryAfterSeconds: 60, unavailable: true };
    }

    if (result.allowed) return { allowed: true, retryAfterSeconds: 0 };

    const retryAfterSeconds = Math.max(1, Math.ceil(result.retry_after_seconds));
    console.warn('API rate limit exceeded:', {
      scope,
      keyFingerprint: keyHash.slice(0, 12),
      limit,
      windowSeconds,
      retryAfterSeconds,
    });
    return { allowed: false, retryAfterSeconds };
  } catch (error) {
    console.error('API rate limiting is not configured:', error);
    return { allowed: false, retryAfterSeconds: 60, unavailable: true };
  }
}

/**
 * Vercel overwrites x-real-ip at its edge. Do not trust arbitrary
 * x-forwarded-for values, which can contain attacker-controlled entries.
 */
export function getTrustedClientIp(request: Request): string | null {
  if (process.env.VERCEL !== '1') return null;

  const candidate = request.headers.get('x-real-ip')?.trim();
  if (!candidate || isIP(candidate) === 0) return null;
  return candidate;
}

export function rateLimitResponseHeaders(retryAfterSeconds: number): HeadersInit {
  return {
    'Cache-Control': 'private, no-store',
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  };
}

export async function checkTrustedIpRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<ApiRateLimitResult | null> {
  const clientIp = getTrustedClientIp(request);
  if (!clientIp) {
    return process.env.VERCEL === '1'
      ? { allowed: false, retryAfterSeconds: 60, unavailable: true }
      : null;
  }

  return checkApiRateLimit({
    scope,
    identifier: clientIp,
    limit,
    windowSeconds,
  });
}
