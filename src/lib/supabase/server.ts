import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';

export async function createClient() {
  const cookieStore =
    await cookies();

  return createServerClient(
    process.env
      .NEXT_PUBLIC_SUPABASE_URL!,
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Server Components can read request cookies; middleware is responsible
        // for propagating refreshed auth cookies back to the response.
        getAll() {
          return cookieStore.getAll();
        },

        setAll() {
          // handled by middleware
        },
      },
    }
  );
}