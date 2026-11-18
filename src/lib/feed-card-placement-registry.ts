import type { Topic } from '@/types';
import { buildOrderedFeedSequence, type FeedCardRule } from './feed-entry-system';
import type { BuildFeedEntryMapOptions, FeedCardEntry } from './feed-entry-map';

export const COMMENT_RULE_ID = 'top-comments';
export const SPONSOR_RULE_ID = 'sponsor';

export const DEFAULT_FEED_CARD_RULES = {
  topComments: { id: COMMENT_RULE_ID, priority: 100 },
  sponsor: { id: SPONSOR_RULE_ID, priority: 200 },
} as const;

export type FeedCardPlacementContext = Pick<
  BuildFeedEntryMapOptions,
  | 'comments'
  | 'userId'
  | 'commentInterval'
  | 'sponsorInterval'
  | 'commentGroupSize'
  | 'sponsorResults'
> & {
  reservedCommentIds: Set<number>;
};

/**
 * Register each card type's cadence, priority, eligibility and inventory here.
 * The generic sequence engine handles ordering and cadence independently.
 */
export function createFeedCardPlacementRules({
  comments,
  reservedCommentIds,
  userId,
  commentInterval = 5,
  sponsorInterval = 10,
  commentGroupSize = 5,
  sponsorResults = new Map(),
}: FeedCardPlacementContext): FeedCardRule<Topic, FeedCardEntry>[] {
  const availableComments = comments.filter((comment) => !reservedCommentIds.has(comment.comment_id));

  const rules: FeedCardRule<Topic, FeedCardEntry>[] = [
    {
      id: DEFAULT_FEED_CARD_RULES.topComments.id,
      interval: commentInterval,
      priority: DEFAULT_FEED_CARD_RULES.topComments.priority,
      createEntry: (topic) => {
        if (availableComments.length === 0) return null;
        const group = availableComments.splice(0, commentGroupSize);
        for (const comment of group) reservedCommentIds.add(comment.comment_id);
        return group.length > 0
          ? { type: 'top-comments', topicId: topic.id, comments: group }
          : null;
      },
    },
    {
      id: DEFAULT_FEED_CARD_RULES.sponsor.id,
      interval: sponsorInterval,
      priority: DEFAULT_FEED_CARD_RULES.sponsor.priority,
      createEntry: (topic) => {
        if (!userId) return null;
        const result = sponsorResults.get(topic.id);
        // Confirmed empty inventory consumes cadence but creates no slot.
        if (result && (result.campaigns.length === 0 || !result.sessionId)) return null;
        return {
          type: 'sponsor',
          topicId: topic.id,
          status: result ? 'ready' : 'pending',
          campaigns: result?.campaigns ?? [],
          sessionId: result?.sessionId ?? null,
        };
      },
    },
  ];

  return rules;
}
