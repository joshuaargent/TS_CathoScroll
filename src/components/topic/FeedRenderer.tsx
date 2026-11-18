import type { ReactNode } from 'react';

import type { FeedEntry } from '@/lib/feed-entry-map';

interface FeedRendererProps {
  activeEntry: FeedEntry | null;
  progress: ReactNode;
  topicCard: ReactNode;
  interstitialCard: ReactNode;
}

/**
 * Renders exactly one entry from the ordered feed map at a time.
 *
 * Topics, top-comment cards and sponsor cards are peers in the same sequence.
 * No card is mounted underneath another card and no entry is presented as an
 * overlay. Each card owns its own interaction/gesture lifecycle; the feed
 * cursor decides which entry occupies this slot next.
 *
 * The progress track is shared by the feed and remains outside the replaceable
 * card slot so it does not unmount during entry navigation.
 */
export function FeedRenderer({
  activeEntry,
  progress,
  topicCard,
  interstitialCard,
}: FeedRendererProps) {
  const isTopic = !activeEntry || activeEntry.type === 'topic';

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-4">
        {progress}
      </div>
      <div className="relative min-h-0 flex-1">
        {isTopic ? topicCard : interstitialCard}
      </div>
    </div>
  );
}
