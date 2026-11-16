import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { NativeGridSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8">
        <h1 className="text-4xl font-extrabold md:text-5xl">Comment reports</h1>
        <p className="text-text-secondary mt-3">Reports are private to admins. Newest reports appear first.</p>
      </div>
      <div className="mt-8"><AdminNavigation /></div>
      <NativeGridSkeleton label="Loading comment reports" />
    </main>
  );
}
