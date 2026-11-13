import 'server-only';

import type { RecommendationPage } from '@/lib/recommendations';
import type { createClient } from '@/lib/supabase/server';

// The RPC owns the weighted scheduling and category keysets; keeping the
// cursor private and uncached prevents one user's preferences reaching another.
export async function getRecommendationPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cursor: unknown = null
): Promise<RecommendationPage> {
  const { data, error } = await supabase.rpc('get_my_recommendation_page', {
    feed_cursor: cursor,
    page_limit: 50,
  });

  if (error) {
    throw new Error(`Unable to load recommendations: ${error.message}`, { cause: error });
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.topics) || !('nextCursor' in data)) {
    throw new Error('The recommendation service returned an invalid page.');
  }

  return data as RecommendationPage;
}
