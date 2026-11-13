'use client';

import { useCallback } from 'react';
import type { TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import type { Topic } from '@/types';
import { TopicFeedCore } from './TopicFeedCore';
import { TopicViewer } from './TopicViewer';

type TopicFeedProps = { topics: Topic[]; userId: string | null } & (
  | { nextCursor: TopicPageCursor | null; personalized?: false }
  | { nextCursor: RecommendationCursor | null; personalized: true }
);

export function TopicFeed({ topics, nextCursor, personalized = false, userId }: TopicFeedProps) {
  const loadPage = useCallback(
    async (cursor: TopicPageCursor | RecommendationCursor) => {
      let response: Response;
      if (personalized && 'categories' in cursor) {
        response = await fetch('/api/content/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        nextCursor?: TopicPageCursor | RecommendationCursor | null;
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
      topics={topics}
      nextCursor={nextCursor}
      personalized={personalized}
      loadPage={loadPage}
      userId={userId}
      viewer={TopicViewer}
    />
  );
}
