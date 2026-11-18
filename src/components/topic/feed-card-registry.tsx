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
    }),
  ];
}
