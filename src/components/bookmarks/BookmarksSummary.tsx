import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';

export function BookmarksHeader({ count }: { count?: number }) {
  return (
    <div className="mt-8 mb-12">
      <h1 className="text-5xl font-extrabold md:text-7xl">Bookmarks</h1>
      <p className="text-text-secondary mt-4 text-lg">Topics you&apos;ve saved for later.</p>
      {count !== undefined && (
        <div className="mt-6">
          <Badge variant="accent" size="lg">
            {count} Bookmarked {count === 1 ? 'Topic' : 'Topics'}
          </Badge>
        </div>
      )}
    </div>
  );
}

export function EmptyBookmarks() {
  return (
    <section className="border-border rounded-2xl border p-12 text-center">
      <h2 className="text-3xl font-bold">No bookmarks yet</h2>
      <p className="text-text-secondary mx-auto mt-4 max-w-xl">
        Save topics while browsing the feed and they&apos;ll appear here for easy access later.
      </p>
      <Link
        href="/"
        className="text-text-primary hover:text-text-secondary mt-8 inline-flex text-lg font-medium"
      >
        Explore the Feed →
      </Link>
    </section>
  );
}
