'use client';

import type { ReactNode } from 'react';
import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { BaseFeedCard } from './BaseFeedCard';

interface SponsorLoadingCardProps {
  onNextTopic: () => void | Promise<void>;
  onPreviousTopic: () => void | Promise<void>;
  error?: boolean;
  onRetry?: () => void;
  previewMode?: boolean;
  active?: boolean;
  nextEntryPreview?: ReactNode;
  previousEntryPreview?: ReactNode;
}

export function SponsorLoadingCard({
  onNextTopic,
  onPreviousTopic,
  error = false,
  onRetry,
  previewMode = false,
  active = true,
  nextEntryPreview,
  previousEntryPreview,
}: SponsorLoadingCardProps) {
  return (
    <FeedInterstitialMotion
      ariaLabel="Sponsored content loading"
      active={active && !previewMode}
      nextPreview={nextEntryPreview}
      previousPreview={previousEntryPreview}
      onSwipeLeft={() => undefined}
      onSwipeRight={() => undefined}
      onNextTopic={onNextTopic}
      onPreviousTopic={onPreviousTopic}
    >
      <div className="h-full w-full" role="status" aria-live="polite" aria-busy={!error}>
        <BaseFeedCard
          title={<span className="text-text-muted text-xs tracking-wider uppercase">Sponsored</span>}
        >
          {error ? (
            <div className="mx-auto w-full max-w-3xl space-y-4 text-center">
              <p className="text-text-secondary text-sm">Sponsored content is temporarily unavailable.</p>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={onRetry}
                className="text-text-muted hover:text-text-primary text-sm font-medium underline underline-offset-4"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl animate-pulse space-y-5">
              <div className="bg-bg-secondary mx-auto h-5 w-3/4 rounded-full" />
              <div className="bg-bg-secondary mx-auto h-4 w-full max-w-xl rounded-full" />
              <div className="bg-bg-secondary mx-auto h-4 w-5/6 rounded-full" />
              <div className="bg-bg-secondary mx-auto mt-8 h-11 w-40 rounded-full" />
            </div>
          )}
        </BaseFeedCard>
        <span className="sr-only">{error ? 'Sponsored content unavailable' : 'Loading sponsored content'}</span>
      </div>
    </FeedInterstitialMotion>
  );
}
