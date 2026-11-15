import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';
import {
  BookmarksGrid,
  BookmarksHeader,
  BookmarksPagination,
  EmptyBookmarks,
} from '@/components/bookmarks/BookmarksSummary';
import { getPublishedTopicsByIds } from '@/lib/content';
import { decodeBookmarkCursor, encodeBookmarkCursor, type BookmarkCursor } from '@/lib/bookmark-cursor';

export const metadata: Metadata = {
  title: 'Bookmarks',
  robots: { index: false, follow: false },
};

const pageSize = 50;

export default async function BookmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const rawCursor = params.cursor;
  if (Array.isArray(rawCursor)) notFound();
  let cursor: BookmarkCursor | null;
  try { cursor = decodeBookmarkCursor(rawCursor); } catch { notFound(); }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  let bookmarksQuery = supabase
    .from('bookmarks')
    .select('topic_id,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('topic_id', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    bookmarksQuery = bookmarksQuery.or(
      'created_at.lt.' + cursor.createdAt + ',and(created_at.eq.' + cursor.createdAt + ',topic_id.lt.' + cursor.topicId + ')'
    );
  }

  const [bookmarkResult, countResult] = await Promise.all([
    bookmarksQuery,
    supabase.from('bookmarks').select('topic_id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);
  if (bookmarkResult.error) throw bookmarkResult.error;
  if (countResult.error) throw countResult.error;

  const rows = bookmarkResult.data ?? [];
  const pageBookmarks = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const lastBookmark = pageBookmarks.at(-1);
  const nextCursor = hasMore && lastBookmark ? encodeBookmarkCursor(lastBookmark) : null;
  const topics = await getPublishedTopicsByIds(pageBookmarks.map((bookmark) => String(bookmark.topic_id)));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const bookmarkedTopics = pageBookmarks.flatMap((bookmark) => {
    const topic = topicById.get(String(bookmark.topic_id));
    return topic ? [{ ...topic, bookmarkedAt: bookmark.created_at }] : [];
  });
  const totalBookmarks = countResult.count ?? 0;

  return (
    <main className="container py-12">
      <BookmarksHeader count={totalBookmarks} />
      {totalBookmarks === 0 ? (
        <EmptyBookmarks />
      ) : bookmarkedTopics.length === 0 ? (
        <p className="text-text-secondary">There are no published topics on this page of your bookmarks.</p>
      ) : (
        <BookmarksGrid topics={bookmarkedTopics} />
      )}
      <BookmarksPagination hasCursor={Boolean(cursor)} nextCursor={nextCursor} />
    </main>
  );
}