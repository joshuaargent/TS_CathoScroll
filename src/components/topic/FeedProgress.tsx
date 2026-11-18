interface FeedProgressProps {
  current: number;
  total: number;
}

/**
 * The single progress indicator used by every feed entry.
 * Keep the original topic-card track, accent fill and transition unchanged;
 * callers only supply the current position and the size of their sequence.
 */
export function FeedProgress({ current, total }: FeedProgressProps) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 1;
  const safeCurrent = Number.isFinite(current) ? Math.min(Math.max(current, 0), safeTotal - 1) : 0;
  const percentage = ((safeCurrent + 1) / safeTotal) * 100;

  return (
    <div className="shrink-0 pb-5">
      <div className="bg-border h-1 w-full overflow-hidden rounded-full">
        <div
          className="bg-accent h-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
