import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { Topic } from '@/types';

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

export function formatSavedDate(dateString?: string) {
  if (!dateString) return '';
  const savedDate = new Date(dateString);
  if (Number.isNaN(savedDate.getTime())) return '';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfSaved = new Date(savedDate.getFullYear(), savedDate.getMonth(), savedDate.getDate());
  const difference = Math.floor((startOfToday.getTime() - startOfSaved.getTime()) / 86_400_000);
  if (difference === 0) return 'Saved today';
  if (difference === 1) return 'Saved yesterday';
  if (difference > 1 && difference < 7) return 'Saved ' + difference + ' days ago';
  return 'Saved ' + savedDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function BookmarksGrid({
  topics,
}: {
  topics: Array<Topic & { bookmarkedAt?: string }>;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {topics.map((topic) => (
        <Link key={topic.id} href={`/topic/${encodeURIComponent(topic.slug)}`}>
          <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
            <Badge variant="accent" size="sm">{topic.category}</Badge>
            <h2 className="mt-4 text-xl leading-tight font-bold">{topic.question}</h2>
            <p className="text-text-secondary mt-3 line-clamp-3">{topic.answer}</p>
            {topic.bookmarkedAt && (
              <p className="text-text-muted mt-6 text-sm">{formatSavedDate(topic.bookmarkedAt)}</p>
            )}
          </article>
        </Link>
      ))}
    </div>
  );
}
