'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { TopFeedComment } from '@/lib/feed-comments';
import type { GeneralFeedCursor, TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import type { Topic } from '@/types';
import { TopicFeedCore } from './TopicFeedCore';
import { TopicViewer } from './TopicViewer';

type TopicFeedProps = { topics: Topic[]; userId: string | null } & (
  | { nextCursor: GeneralFeedCursor | TopicPageCursor | null; personalized?: false; generalRanked?: boolean }
  | { nextCursor: RecommendationCursor | null; personalized: true; generalRanked?: false }
);

export function TopicFeed({ topics, nextCursor, personalized = false, generalRanked = false, userId }: TopicFeedProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [activeUserId, setActiveUserId] = useState(userId);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setActiveUserId(session?.user.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);
  const getSponsorAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [supabase]);
  const openTopComment = useCallback(
    (comment: TopFeedComment) => {
      router.push(
        `/topic/${encodeURIComponent(comment.topic_slug)}#comment-${comment.comment_id}`
      );
    },
    [router]
  );

  const loadPage = useCallback(
    async (cursor: GeneralFeedCursor | TopicPageCursor | RecommendationCursor) => {
      let response: Response;
      if (personalized && 'categories' in cursor && 'userId' in cursor) {
        response = await fetch('/api/content/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor }),
        });
      } else if (!personalized && 'categories' in cursor) {
        response = await fetch('/api/content/general-feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ cursor }),
        });
      } else if (!personalized && 'orderIndex' in cursor) {
        const params = new URLSearchParams({
          afterOrder: String(cursor.orderIndex),
          afterId: cursor.id,
          limit: '50',
        });
        response = await fetch(`/api/content/topics?${params.toString()}`);
      } else {
        throw new Error('The topic feed cursor is invalid. Refresh the page.');
      }
      const result = (await response.json()) as {
        topics?: Topic[];
        nextCursor?: GeneralFeedCursor | TopicPageCursor | RecommendationCursor | null;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Unable to load more topics.');
      if (!Array.isArray(result.topics) || result.nextCursor === undefined) {
        throw new Error('The topic service returned an invalid page.');
      }
      return { topics: result.topics, nextCursor: result.nextCursor };
    },
    [personalized]
  );
  return (
    <TopicFeedCore
      key={activeUserId ?? 'signed-out'}
      topics={topics}
      nextCursor={nextCursor}
      personalized={personalized}
      generalRanked={generalRanked}
      preservePositionOnUpdate
      loadPage={loadPage}
      userId={activeUserId}
      getSponsorAccessToken={getSponsorAccessToken}
      viewer={TopicViewer}
      onOpenComment={openTopComment}
    />
  );
}
