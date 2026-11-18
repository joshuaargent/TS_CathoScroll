import type { ReactNode } from 'react';

/**
 * The single viewport for the ordered feed-entry map.
 *
 * The registry resolves the active topic, comment or sponsor entry into one
 * card. No inactive card is mounted beneath it or presented as an overlay.
 * The shared progress track remains outside the replaceable card slot.
 */
interface FeedRendererProps {
  progress: ReactNode;
  entryCard: ReactNode;
}

export function FeedRenderer({ progress, entryCard }: FeedRendererProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-4">
        {progress}
      </div>
      <div className="relative min-h-0 flex-1">
        {entryCard}
      </div>
    </div>
  );
}
