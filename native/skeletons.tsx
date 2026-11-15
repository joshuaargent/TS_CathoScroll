import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

export function NativeGridSkeleton({ label }: { label: string }) {
  return (
    <section role="status" aria-label={label} aria-busy="true">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </section>
  );
}

export function NativeTopicSkeleton({ label }: { label: string }) {
  return (
    <section role="status" aria-label={label} aria-busy="true" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-12 w-4/5 max-w-3xl" />
        <Skeleton className="h-5 w-2/3 max-w-2xl" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </section>
  );
}

export function NativeProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading public profile" aria-busy="true" className="space-y-12">
      <section className="space-y-4">
        <Skeleton className="h-12 w-2/3 max-w-md" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </section>
      <section className="space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36 w-full" variant="rectangular" />
      </section>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}

export function NativeNotificationsSkeleton() {
  return (
    <div role="status" aria-label="Loading notifications" aria-busy="true" className="space-y-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="border-border rounded-xl border p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
