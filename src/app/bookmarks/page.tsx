import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';

import { Badge } from '@/components/ui/Badge';
import { BookmarksHeader, EmptyBookmarks } from '@/components/bookmarks/BookmarksSummary';

import { getPublishedTopicsByIds } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Bookmarks',
  robots: {
    index: false,
    follow: false,
  },
};

function formatSavedDate(dateString: string) {
  const savedDate = new Date(dateString);

  const today = new Date();

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const startOfSaved = new Date(savedDate.getFullYear(), savedDate.getMonth(), savedDate.getDate());

  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfSaved.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) {
    return 'Saved today';
  }

  if (diffDays === 1) {
    return 'Saved yesterday';
  }

  if (diffDays < 7) {
    return `Saved ${diffDays} days ago`;
  }

  return `Saved ${savedDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

export default async function BookmarksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin');
  }

  const { data: bookmarks } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', {
      ascending: false,
    });

  const savedBookmarks = bookmarks ?? [];
  const topics = await getPublishedTopicsByIds(
    savedBookmarks.map((bookmark) => String(bookmark.topic_id))
  );
  const bookmarkByTopicId = new Map(
    savedBookmarks.map((bookmark) => [String(bookmark.topic_id), bookmark.created_at])
  );
  const bookmarkedTopics = topics.map((topic) => ({
    ...topic,
    bookmarkedAt: bookmarkByTopicId.get(topic.id) ?? '',
  }));

  return (
    <main className="container py-12">
      <BookmarksHeader count={bookmarkedTopics.length} />

      {bookmarkedTopics.length === 0 ? (
        <EmptyBookmarks />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {bookmarkedTopics.map((topic) => (
            <Link key={topic.id} href={`/topic/${topic.slug}`}>
              <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                <Badge variant="accent" size="sm">
                  {topic.category}
                </Badge>

                <h2 className="mt-4 text-xl leading-tight font-bold">{topic.question}</h2>

                <p className="text-text-secondary mt-3 line-clamp-3">{topic.answer}</p>

                <p className="text-text-muted mt-6 text-sm">
                  {formatSavedDate(topic.bookmarkedAt)}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
