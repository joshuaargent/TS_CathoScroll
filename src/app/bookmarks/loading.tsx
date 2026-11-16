import { BookmarksHeader } from '@/components/bookmarks/BookmarksSummary';
import { NativeGridSkeleton } from '../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <BookmarksHeader />
      <NativeGridSkeleton label="Loading bookmarks" />
    </main>
  );
}
