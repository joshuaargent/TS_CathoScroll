import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let client: ReturnType<typeof createSupabaseClient> | undefined;

export function createClient() {
  if (!client) {
    const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || new URL(url).protocol !== 'https:') {
      throw new Error('Public HTTPS Supabase configuration is required for online features.');
    }
    client = createSupabaseClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
