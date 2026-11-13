'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { shuffle } from '@/lib/utils';

import type { TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import { Topic } from '@/types';

import { TopicViewer } from './TopicViewer';

type TopicFeedProps = {
  topics: Topic[];
  userId: string | null;
} & (
  | { nextCursor: TopicPageCursor | null; personalized?: false }
  | { nextCursor: RecommendationCursor | null; personalized: true }
);

export function TopicFeed({
  topics,
  nextCursor: initialCursor,
  personalized = false,
  userId,
}: TopicFeedProps) {
  const [feedTopics, setFeedTopics] = useState<Topic[]>(topics);

  const [topicIndex, setTopicIndex] = useState(personalized ? 0 : Math.floor(topics.length / 2));
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    // Signed-out users get the existing shuffled feed; personalized server
    // ranking is preserved for signed-in users and starts at its top result.
    const shuffled = personalized ? topics : shuffle(topics);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedTopics(shuffled);

    setTopicIndex(personalized ? 0 : Math.floor(shuffled.length / 2));
    setNextCursor(initialCursor);
  }, [topics, initialCursor, personalized]);

  const loadMoreTopics = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError('');

    try {
      let response: Response;
      if (personalized && 'categories' in nextCursor) {
        response = await fetch('/api/content/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor: nextCursor }),
        });
      } else if (!personalized && 'orderIndex' in nextCursor) {
        const params = new URLSearchParams({
          afterOrder: String(nextCursor.orderIndex),
          afterId: nextCursor.id,
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

      if (!response.ok) {
        throw new Error(result.error ?? 'Unable to load more topics.');
      }

      if (!Array.isArray(result.topics) || result.nextCursor === undefined) {
        throw new Error('The topic service returned an invalid page.');
      }
      const newTopics = result.topics;
      setFeedTopics((previous) => [
        ...previous,
        ...(personalized ? newTopics : shuffle(newTopics)),
      ]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      console.error('Unable to load the next topic feed page:', error);
      setLoadError(error instanceof Error ? error.message : 'Unable to load more topics.');
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, personalized]);

  // ----------------------------------
  // Navigation
  // ----------------------------------

  // Modulo arithmetic wraps the finite catalogue into a circular feed.
  const nextTopic = () => {
    if (topicIndex >= feedTopics.length - 3 && nextCursor) {
      void loadMoreTopics();
    }

    if (topicIndex >= feedTopics.length - 1 && nextCursor) {
      return;
    }

    setTopicIndex((prev) => (prev + 1) % feedTopics.length);
  };

  const previousTopic = () => {
    setTopicIndex((prev) => (prev - 1 + feedTopics.length) % feedTopics.length);
  };

  // ----------------------------------
  // Loading
  // ----------------------------------

  if (!feedTopics.length) {
    return null;
  }

  return (
    <div className="h-full">
      {(loadingMore || loadError) && (
        <div className="bg-bg-primary/90 absolute top-20 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow">
          {loadError ? (
            <button type="button" onClick={() => void loadMoreTopics()} className="text-accent">
              {loadError} Retry
            </button>
          ) : (
            <span className="text-text-secondary">Loading more topics…</span>
          )}
        </div>
      )}
      <TopicViewer
        topics={feedTopics}
        topicIndex={topicIndex}
        initialUserId={userId}
        onNextTopic={nextTopic}
        onPreviousTopic={previousTopic}
      />
    </div>
  );
}
