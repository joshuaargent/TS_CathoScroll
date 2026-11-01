interface TopicProgressProps {
  current: number;
  total: number;
}

export function TopicProgress({ current, total }: TopicProgressProps) {
  const percentage = ((current + 1) / total) * 100;

  return (
    <div className="bg-border h-1 w-full overflow-hidden rounded-full">
      <div
        className="bg-accent h-full transition-all duration-300"
        style={{
          width: `${percentage}%`,
        }}
      />
    </div>
  );
}
