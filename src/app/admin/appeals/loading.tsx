import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { NativeGridSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8">
        <h1 className="text-4xl font-extrabold md:text-5xl">Comment-ban appeals</h1>
        <p className="text-text-secondary mt-3">Review a user’s appeal and inspect their complete comment history, including reply context.</p>
      </div>
      <div className="mt-8"><AdminNavigation /></div>
      <NativeGridSkeleton label="Loading comment-ban appeals" />
    </main>
  );
}
