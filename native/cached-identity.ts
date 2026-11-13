import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

export type CachedIdentity = Pick<User, 'id' | 'email'>;

export function identityAfterAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
  cached: CachedIdentity | null
): CachedIdentity | null {
  if (session?.user) return { id: session.user.id, email: session.user.email };
  return event === 'INITIAL_SESSION' ? cached : null;
}

export function cachedIdentityFromSession(value: string | null): CachedIdentity | null {
  if (value === null) return null;
  let session: unknown;
  try {
    session = JSON.parse(value);
  } catch {
    throw new Error('The saved account session is invalid.');
  }
  if (
    !session ||
    typeof session !== 'object' ||
    !('access_token' in session) ||
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    !('refresh_token' in session) ||
    typeof session.refresh_token !== 'string' ||
    !session.refresh_token ||
    !('expires_at' in session) ||
    typeof session.expires_at !== 'number' ||
    !Number.isFinite(session.expires_at) ||
    !('user' in session) ||
    !session.user ||
    typeof session.user !== 'object' ||
    !('id' in session.user) ||
    typeof session.user.id !== 'string' ||
    !session.user.id ||
    session.user.id.trim() !== session.user.id
  ) {
    throw new Error('The saved account session is invalid.');
  }
  const email = 'email' in session.user ? session.user.email : undefined;
  if (email !== undefined && typeof email !== 'string') {
    throw new Error('The saved account session is invalid.');
  }
  return { id: session.user.id, email };
}
