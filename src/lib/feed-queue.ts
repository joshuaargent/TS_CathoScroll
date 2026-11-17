import type { TopFeedComment } from './feed-comments';
import type { SponsorFeedCampaign } from './sponsor-campaigns';

export type FeedQueueEntry =
  | {
      type: 'topic';
      id: string;
      topicId: string;
      topicIndex: number;
    }
  | {
      type: 'top-comments';
      id: string;
      topicId: string;
      topicIndex: number;
      comments: TopFeedComment[];
    }
  | {
      type: 'sponsor';
      id: string;
      topicId: string;
      topicIndex: number;
      campaigns: SponsorFeedCampaign[];
      sessionId: string;
    };

export interface FeedQueueWindow {
  previous: FeedQueueEntry | null;
  current: FeedQueueEntry | null;
  next: FeedQueueEntry | null;
}

export function buildFeedQueue(
  topics: ReadonlyArray<{ id: string }>,
  commentsByTopicId: ReadonlyMap<string, TopFeedComment[]>,
  sponsorsByTopicId: ReadonlyMap<string, { campaigns: SponsorFeedCampaign[]; sessionId: string }>
): FeedQueueEntry[] {
  const queue: FeedQueueEntry[] = [];

  topics.forEach((topic, topicIndex) => {
    queue.push({
      type: 'topic',
      id: `topic:${topic.id}`,
      topicId: topic.id,
      topicIndex,
    });

    const comments = commentsByTopicId.get(topic.id);
    if (comments?.length) {
      queue.push({
        type: 'top-comments',
        id: `comments:${topic.id}`,
        topicId: topic.id,
        topicIndex,
        comments,
      });
    }

    const sponsor = sponsorsByTopicId.get(topic.id);
    if (sponsor?.campaigns.length && sponsor.sessionId) {
      queue.push({
        type: 'sponsor',
        id: `sponsor:${topic.id}`,
        topicId: topic.id,
        topicIndex,
        campaigns: sponsor.campaigns,
        sessionId: sponsor.sessionId,
      });
    }
  });

  return queue;
}

export function findFeedQueueEntryIndex(
  queue: ReadonlyArray<FeedQueueEntry>,
  topicIndex: number,
  type: FeedQueueEntry['type']
): number {
  return queue.findIndex((entry) => entry.topicIndex === topicIndex && entry.type === type);
}

export function getFeedQueueWindow(
  queue: ReadonlyArray<FeedQueueEntry>,
  activeIndex: number
): FeedQueueWindow {
  if (!Number.isSafeInteger(activeIndex) || activeIndex < 0 || activeIndex >= queue.length) {
    return { previous: null, current: null, next: null };
  }

  return {
    previous: activeIndex > 0 ? queue[activeIndex - 1] : null,
    current: queue[activeIndex],
    next: activeIndex + 1 < queue.length ? queue[activeIndex + 1] : null,
  };
}
