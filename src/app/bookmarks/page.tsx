import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';

import { BookmarksGrid, BookmarksHeader, EmptyBookmarks } from '@/components/bookmarks/BookmarksSummary';

import { getPublishedTopicsByIds } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Bookmarks',
  robots: {
    index: false,
    follow: false,
  },
};

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
        <BookmarksGrid topics={bookmarkedTopics} />
      )}
    </main>
  );
}
