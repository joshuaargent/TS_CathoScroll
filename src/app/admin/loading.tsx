import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { NativeGridSkeleton } from '../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8">
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Admin dashboard</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Review private reports and comment-ban appeals. Admin actions are recorded for accountability.
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>
      <NativeGridSkeleton label="Loading moderation data" />
    </main>
  );
}
