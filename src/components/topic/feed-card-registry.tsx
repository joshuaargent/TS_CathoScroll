'use client';

import { TopCommentFeedCard } from './TopCommentFeedCard';
import { SponsorFeedCard } from './SponsorFeedCard';
import { SponsorLoadingCard } from './SponsorLoadingCard';
import {
  invokeRegisteredFeedEntryAction,
  registerFeedEntry,
  type FeedEntryRegistration,
} from '@/lib/feed-entry-registry';
import type { FeedEntry } from '@/lib/feed-entry-map';
import type { FeedCardRendererContext } from './feed-card-registry.types';

export function createFeedCardRegistry(
  context: FeedCardRendererContext
): FeedEntryRegistration<FeedCardRendererContext>[] {
  let registrations: FeedEntryRegistration<FeedCardRendererContext>[] = [];
  registrations = [
    registerFeedEntry<Extract<FeedEntry, { type: 'top-comments' }>, FeedCardRendererContext>('top-comments', {
      render: (entry) => (
        <TopCommentFeedCard
          key={`${context.userId ?? 'anonymous'}:${entry.topicId}`}
          userId={context.userId}
          previewMode={context.previewMode}
          active={!context.previewMode}
          comments={entry.comments}
          initialActiveIndex={context.activeTopCommentIndex}
          onActiveIndexChange={(index) => context.onTopCommentIndexChange(entry.topicId, index)}
          onProgressChange={context.onProgressChange}
          onCommentViewed={context.onCommentViewed}
          onNextTopic={() => invokeRegisteredFeedEntryAction(entry, 'next', registrations, context)}
          onPreviousTopic={() => invokeRegisteredFeedEntryAction(entry, 'previous', registrations, context)}
          onOpenComment={context.onOpenComment}
          nextEntryPreview={context.nextEntryPreview}
          previousEntryPreview={context.previousEntryPreview}
        />
      ),
      onNext: context.navigateNext,
      onPrevious: context.navigatePrevious,
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
      render: (entry) => entry.status === 'pending' || entry.status === 'error' ? (
        <SponsorLoadingCard
          key={`sponsor-loading:${entry.topicId}`}
          onNextTopic={() => invokeRegisteredFeedEntryAction(entry, 'next', registrations, context)}
          onPreviousTopic={() => invokeRegisteredFeedEntryAction(entry, 'previous', registrations, context)}
          error={entry.status === 'error'}
          onRetry={() => context.retrySponsorEntry(entry)}
          previewMode={context.previewMode}
          active={!context.previewMode}
          nextEntryPreview={context.nextEntryPreview}
          previousEntryPreview={context.previousEntryPreview}
        />
      ) : (
        <SponsorFeedCard
          key={`sponsor:${entry.topicId}:${entry.sessionId ?? 'pending'}`}
          campaigns={entry.campaigns}
          previewMode={context.previewMode}
          sessionId={entry.sessionId ?? ''}
          userId={context.userId ?? ''}
          sponsorApiBaseUrl={context.sponsorApiBaseUrl}
          getAccessToken={context.getSponsorAccessToken ?? (async () => null)}
          onNextTopic={() => invokeRegisteredFeedEntryAction(entry, 'next', registrations, context)}
          onPreviousTopic={() => invokeRegisteredFeedEntryAction(entry, 'previous', registrations, context)}
          nextEntryPreview={context.nextEntryPreview}
          previousEntryPreview={context.previousEntryPreview}
        />
      ),
      onNext: context.navigateNext,
      onPrevious: context.navigatePrevious,
      onEnter: async (entry, direction, entries, cardContext) => {
        cardContext.activateInterstitialTopic(entry.topicId);
        if (entry.status === 'pending' || entry.status === 'error') {
          await cardContext.loadSponsorEntry(entry, direction, entries);
        }
      },
      onExit: (entry, direction, cardContext) => {
        cardContext.cancelSponsorRequest(entry, direction);
      },
    }),
  ];
  return registrations;
}
