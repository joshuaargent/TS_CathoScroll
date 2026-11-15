import { Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      aria-busy="true"
      className="container py-4"
    >
      <Skeleton className="h-1 w-full" />
    </div>
  );
}
