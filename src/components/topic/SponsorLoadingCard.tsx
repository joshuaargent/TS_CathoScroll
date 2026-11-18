'use client';

import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { TopicCardLayout } from './TopicCardLayout';

interface SponsorLoadingCardProps {
  onNextTopic: () => void | Promise<void>;
  onPreviousTopic: () => void | Promise<void>;
}

export function SponsorLoadingCard({
  onNextTopic,
  onPreviousTopic,
}: SponsorLoadingCardProps) {
  return (
    <FeedInterstitialMotion
      ariaLabel="Sponsored content loading"
      onSwipeLeft={() => undefined}
      onSwipeRight={() => undefined}
      onNextTopic={onNextTopic}
      onPreviousTopic={onPreviousTopic}
    >
      <div className="h-full w-full" role="status" aria-live="polite" aria-busy="true">
        <TopicCardLayout
          header={
            <span className="text-text-muted text-xs tracking-wider uppercase">
              Sponsored
            </span>
          }
        >
          <div className="mx-auto w-full max-w-3xl animate-pulse space-y-5">
            <div className="bg-bg-secondary mx-auto h-5 w-3/4 rounded-full" />
            <div className="bg-bg-secondary mx-auto h-4 w-full max-w-xl rounded-full" />
            <div className="bg-bg-secondary mx-auto h-4 w-5/6 rounded-full" />
            <div className="bg-bg-secondary mx-auto mt-8 h-11 w-40 rounded-full" />
          </div>
        </TopicCardLayout>
        <span className="sr-only">Loading sponsored content</span>
      </div>
    </FeedInterstitialMotion>
  );
}
