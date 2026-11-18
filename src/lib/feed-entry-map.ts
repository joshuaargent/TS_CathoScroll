import type { Topic } from '@/types';
import type { TopFeedComment } from '@/lib/feed-comments';
import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';

export type FeedEntry =
  | { type: 'topic'; topicId: string; topic: Topic }
  | { type: 'top-comments'; topicId: string; comments: TopFeedComment[] }
  | {
      type: 'sponsor';
      topicId: string;
      status: 'pending' | 'ready' | 'empty';
      campaigns: SponsorFeedCampaign[];
      sessionId: string | null;
    };

export type FeedBoundary = {
  topicId: string;
  entries: FeedEntry[];
};

export type FeedEntryMap = {
  boundaries: FeedBoundary[];
  byTopicId: Map<string, FeedBoundary>;
  commentCadence: number;
  sponsorCadence: number;
  reservedCommentIds: Set<number>;
};

export type BuildFeedEntryMapOptions = {
  topics: Topic[];
  comments: TopFeedComment[];
  seenCommentIds: ReadonlySet<number>;
  userId: string | null;
  commentCadence?: number;
  sponsorCadence?: number;
  commentInterval?: number;
  sponsorInterval?: number;
  commentGroupSize?: number;
  sponsorResults?: ReadonlyMap<
    string,
    { campaigns: SponsorFeedCampaign[]; sessionId: string | null }
  >;
};

/**
 * Builds the ordered feed sequence from the original analytics-ranked topic
 * list. Interstitial decisions are made here, never in swipe handlers.
 *
 * A topic boundary owns its following comment/sponsor entries. If both
 * intervals land on the same boundary, comments are ordered before sponsors.
 */
export function buildFeedEntryMap({
  topics,
  comments,
  seenCommentIds,
  userId,
  commentCadence = 0,
  sponsorCadence = 0,
  commentInterval = 5,
  sponsorInterval = 10,
  commentGroupSize = 5,
  sponsorResults = new Map(),
}: BuildFeedEntryMapOptions): FeedEntryMap {
  if (!Number.isSafeInteger(commentInterval) || commentInterval < 1) {
    throw new RangeError('commentInterval must be a positive integer');
  }
  if (!Number.isSafeInteger(sponsorInterval) || sponsorInterval < 1) {
    throw new RangeError('sponsorInterval must be a positive integer');
  }
  if (!Number.isSafeInteger(commentGroupSize) || commentGroupSize < 1) {
    throw new RangeError('commentGroupSize must be a positive integer');
  }

  const reservedCommentIds = new Set(seenCommentIds);
  const availableComments = comments.filter((comment) => !reservedCommentIds.has(comment.comment_id));
  const boundaries: FeedBoundary[] = [];
  const byTopicId = new Map<string, FeedBoundary>();
  let nextCommentCadence = commentCadence;
  let nextSponsorCadence = sponsorCadence;

  for (const topic of topics) {
    const entries: FeedEntry[] = [{ type: 'topic', topicId: topic.id, topic }];
    nextCommentCadence += 1;
    nextSponsorCadence += 1;

    const commentDue = nextCommentCadence >= commentInterval && availableComments.length > 0;
    const sponsorDue = nextSponsorCadence >= sponsorInterval && Boolean(userId);

    if (commentDue) {
      const group = availableComments.splice(0, commentGroupSize);
      for (const comment of group) reservedCommentIds.add(comment.comment_id);
      if (group.length > 0) {
        entries.push({ type: 'top-comments', topicId: topic.id, comments: group });
        nextCommentCadence = 0;
      }
    }

    if (sponsorDue) {
      const result = sponsorResults.get(topic.id);
      entries.push({
        type: 'sponsor',
        topicId: topic.id,
        status: result ? (result.campaigns.length > 0 && result.sessionId ? 'ready' : 'empty') : 'pending',
        campaigns: result?.campaigns ?? [],
        sessionId: result?.sessionId ?? null,
      });
      nextSponsorCadence = 0;
    }

    const boundary = { topicId: topic.id, entries };
    boundaries.push(boundary);
    byTopicId.set(topic.id, boundary);
  }

  return {
    boundaries,
    byTopicId,
    commentCadence: nextCommentCadence,
    sponsorCadence: nextSponsorCadence,
    reservedCommentIds,
  };
}

/** Flatten the boundary map into the exact sequence consumed by the viewer. */
export function flattenFeedEntryMap(map: FeedEntryMap): FeedEntry[] {
  return map.boundaries.flatMap((boundary) => boundary.entries);
}
