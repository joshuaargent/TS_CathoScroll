import { Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Account security</h1>
        <p className="text-text-secondary mt-4 text-lg">
          Manage authenticator verification and administrator sign-in security.
        </p>
      </div>
      <section className="max-w-3xl space-y-6" role="status" aria-label="Loading account security" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-48" />
      </section>
    </main>
  );
}
