'use client';

import { TopCommentFeedCard } from './TopCommentFeedCard';
import { SponsorFeedCard } from './SponsorFeedCard';
import { SponsorLoadingCard } from './SponsorLoadingCard';
import {
  registerFeedEntry,
  type FeedEntryRegistration,
} from '@/lib/feed-entry-registry';
import type { FeedEntry } from '@/lib/feed-entry-map';
import type { FeedCardRendererContext } from './feed-card-registry.types';

export function createFeedCardRegistry(
  context: FeedCardRendererContext
): FeedEntryRegistration<FeedCardRendererContext>[] {
  return [
    registerFeedEntry<Extract<FeedEntry, { type: 'top-comments' }>, FeedCardRendererContext>('top-comments', {
      render: (entry) => (
        <TopCommentFeedCard
          key={context.userId ?? 'anonymous'}
          userId={context.userId}
          comments={entry.comments}
          initialActiveIndex={context.activeTopCommentIndex}
          onActiveIndexChange={(index) => context.onTopCommentIndexChange(entry.topicId, index)}
          onCommentViewed={context.onCommentViewed}
          onNextTopic={() => context.onNext(entry)}
          onPreviousTopic={() => context.onPrevious(entry)}
          onOpenComment={context.onOpenComment}
        />
      ),
      onNext: context.onNext,
      onPrevious: context.onPrevious,
      onEnter: (entry, _direction, _entries, cardContext) => {
        cardContext.activateInterstitialTopic(entry.topicId);
        for (const comment of entry.comments) cardContext.markCommentSeen(comment.comment_id);
        cardContext.cacheCommentGroup(entry.topicId, entry.comments);
        const safeIndex = Math.min(
          cardContext.getTopCommentIndex(entry.topicId),
          Math.max(0, entry.comments.length - 1)
        );
        cardContext.onTopCommentIndexChange(entry.topicId, safeIndex);
      },
    }),
    registerFeedEntry<Extract<FeedEntry, { type: 'sponsor' }>, FeedCardRendererContext>('sponsor', {
      render: (entry) => entry.status === 'pending' ? (
        <SponsorLoadingCard
          onNextTopic={() => context.onNext(entry)}
          onPreviousTopic={() => context.onPrevious(entry)}
        />
      ) : (
        <SponsorFeedCard
          campaigns={entry.campaigns}
          sessionId={entry.sessionId ?? ''}
          userId={context.userId ?? ''}
          sponsorApiBaseUrl={context.sponsorApiBaseUrl}
          getAccessToken={context.getSponsorAccessToken ?? (async () => null)}
          onNextTopic={() => context.onNext(entry)}
          onPreviousTopic={() => context.onPrevious(entry)}
        />
      ),
      onNext: context.onNext,
      onPrevious: context.onPrevious,
      onEnter: async (entry, direction, entries, cardContext) => {
        cardContext.activateInterstitialTopic(entry.topicId);
        if (entry.status === 'pending') {
          await cardContext.loadSponsorEntry(entry, direction, entries);
        }
      },
      onExit: (entry, direction, cardContext) => {
        cardContext.cancelSponsorRequest(entry, direction);
      },
    }),
  ];
}
