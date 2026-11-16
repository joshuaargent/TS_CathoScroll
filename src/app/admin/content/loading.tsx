import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { NativeGridSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Content library</h1>
        <p className="text-text-secondary mt-3 max-w-3xl">
          Create, edit, organise, publish, and archive categories and learning topics.
        </p>
      </div>
      <div className="mt-8"><AdminNavigation /></div>
      <NativeGridSkeleton label="Loading content library" />
    </main>
  );
}
