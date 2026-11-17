interface TopicProgressProps {
  current: number;
  total: number;
}

export function TopicProgress({ current, total }: TopicProgressProps) {
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
