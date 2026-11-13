import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  assertSecureAuthStorageAvailable,
  authStorageKey,
  secureAuthStorage,
} from './secure-auth-storage';

let client: SupabaseClient | undefined;
let secureSessions = false;

export async function initializeNativeAuth(): Promise<void> {
  if (client) throw new Error('Native authentication must be initialized before the client.');
  await assertSecureAuthStorageAvailable();
  secureSessions = true;
}

export function createClient(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || new URL(url).protocol !== 'https:') {
      throw new Error('Public HTTPS Supabase configuration is required for online features.');
    }
    client = createSupabaseClient(url, key, {
      auth: {
        persistSession: secureSessions,
        autoRefreshToken: secureSessions,
        detectSessionInUrl: false,
        ...(secureSessions && { storage: secureAuthStorage, storageKey: authStorageKey }),
      },
    });
  }
  return client;
}
