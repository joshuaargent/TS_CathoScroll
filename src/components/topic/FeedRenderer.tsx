import type { ReactNode } from 'react';

import type { FeedEntry } from '@/lib/feed-entry-map';

interface FeedRendererProps {
  activeEntry: FeedEntry | null;
  progress: ReactNode;
  topicViewer: ReactNode;
  interstitialCard: ReactNode;
}

/**
 * The single viewport renderer for the ordered feed-entry stream.
 *
 * The original topic viewer deliberately remains mounted beneath interstitial
 * entries. This preserves its swipe animation state and prevents a topic
 * remount/flash when navigating into or out of comments and sponsor cards.
 */
export function FeedRenderer({
  activeEntry,
  progress,
  topicViewer,
  interstitialCard,
}: FeedRendererProps) {
  const showingInterstitial = Boolean(activeEntry && activeEntry.type !== 'topic');

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-4">
        {progress}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          className={showingInterstitial
            ? 'invisible pointer-events-none absolute inset-0'
            : 'absolute inset-0'}
          aria-hidden={showingInterstitial}
        >
          {topicViewer}
        </div>
        {showingInterstitial && interstitialCard && (
          <div className="absolute inset-0 z-10">
            {interstitialCard}
          </div>
        )}
      </div>
    </div>
  );
}
