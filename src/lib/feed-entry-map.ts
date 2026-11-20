import type { Topic } from '@/types';
import type { TopFeedComment } from '@/lib/feed-comments';
import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';
import { buildOrderedFeedSequence } from './feed-entry-system';
import {
  createFeedCardPlacementRules,
  COMMENT_RULE_ID,
  SPONSOR_RULE_ID,
} from './feed-card-placement-registry';
export { DEFAULT_FEED_CARD_RULES } from './feed-card-placement-registry';

export type FeedEntry =
  | { type: 'topic'; topicId: string; topic: Topic }
  | { type: 'top-comments'; topicId: string; comments: TopFeedComment[] }
  | {
      type: 'sponsor';
      topicId: string;
      status: 'pending' | 'ready' | 'empty' | 'error';
      campaigns: SponsorFeedCampaign[];
      sessionId: string | null;
    };

export type FeedCardEntry = Exclude<FeedEntry, { type: 'topic' }>;

export type FeedBoundary = {
  topicId: string;
  entries: FeedEntry[];
  cadenceAfter: Readonly<Record<string, number>>;
  /** Compatibility fields for existing feed diagnostics and UI state. */
  commentCadenceAfter: number;
  sponsorCadenceAfter: number;
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
 * list. Card-specific placement rules are registered independently; the
 * shared sequence engine owns cadence advancement and deterministic order.
 *
 * Lower rule priorities appear first. Thus Top Comments precede sponsors
 * when both rules are due at the same topic boundary.
 */
export function buildFeedEntryMap({
  topics,
  comments,
  seenCommentIds,
  commentCadence = 0,
  sponsorCadence = 0,
  commentInterval = 5,
  sponsorInterval = 10,
  commentGroupSize = 5,
  sponsorResults = new Map(),
}: BuildFeedEntryMapOptions): FeedEntryMap {
  if (!Number.isSafeInteger(commentGroupSize) || commentGroupSize < 1) {
    throw new RangeError('commentGroupSize must be a positive integer');
  }

  const reservedCommentIds = new Set(seenCommentIds);
  const cardRules = createFeedCardPlacementRules({
    comments,
    reservedCommentIds,
    commentInterval,
    sponsorInterval,
    commentGroupSize,
    sponsorResults,
  });

  const sequence = buildOrderedFeedSequence<Topic, FeedCardEntry>({
    topics,
    cardRules,
    initialCadence: {
      [COMMENT_RULE_ID]: commentCadence,
      [SPONSOR_RULE_ID]: sponsorCadence,
    },
  });

  const boundaries: FeedBoundary[] = sequence.boundaries.map((boundary) => ({
    ...boundary,
    entries: boundary.entries as FeedEntry[],
    cadenceAfter: boundary.cadenceAfter,
    commentCadenceAfter: boundary.cadenceAfter[COMMENT_RULE_ID] ?? 0,
    sponsorCadenceAfter: boundary.cadenceAfter[SPONSOR_RULE_ID] ?? 0,
  }));
  const byTopicId = new Map(boundaries.map((boundary) => [boundary.topicId, boundary] as const));

  return {
    boundaries,
    byTopicId,
    commentCadence: sequence.cadence[COMMENT_RULE_ID] ?? 0,
    sponsorCadence: sequence.cadence[SPONSOR_RULE_ID] ?? 0,
    reservedCommentIds,
  };
}

/** Flatten the boundary map into the exact sequence consumed by the viewer. */
export function flattenFeedEntryMap(map: FeedEntryMap): FeedEntry[] {
  return map.boundaries.flatMap((boundary) => boundary.entries);
}

/**
 * Comment groups already assigned to the preserved feed prefix remain
 * reserved even if the user has not opened those cards yet.
 */
export function collectReservedCommentIds(
  boundaries: readonly FeedBoundary[],
  seenCommentIds: ReadonlySet<number>
): Set<number> {
  const reserved = new Set(seenCommentIds);
  for (const boundary of boundaries) {
    for (const entry of boundary.entries) {
      if (entry.type !== 'top-comments') continue;
      for (const comment of entry.comments) reserved.add(comment.comment_id);
    }
  }
  return reserved;
}
