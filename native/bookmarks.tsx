import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BookmarksGrid, BookmarksHeader, EmptyBookmarks } from '@/components/bookmarks/BookmarksSummary';
import type { OfflineCatalogue } from '@/lib/offline/catalogue';
import type { Topic } from '@/types';
import { createClient } from './supabase';
import type { NativeActivity, NativeActivityStatus } from './activity';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

export function NativeBookmarks({
  catalogue,
  userId,
  activity,
  status,
  version,
}: {
  catalogue: OfflineCatalogue;
  userId: string | null;
  activity: NativeActivity | null;
  status: NativeActivityStatus | null;
  version: number;
}) {
  const [topics, setTopics] = useState<Array<Topic & { bookmarkedAt?: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const ready = Boolean(
    userId && activity?.userId === userId && status?.userId === userId && status.ready
  );

  useEffect(() => {
    const noticeId = userId ? 'bookmarks-setup:' + userId : '';
    const update = () => {
      if (!userId || ready || navigator.onLine) {
        if (noticeId) clearNativeStatusNotice(noticeId);
        return;
      }
      notifyNativeStatus('Connect to set up your saved bookmarks on this device.', {
        id: noticeId,
      });
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      if (noticeId) clearNativeStatusNotice(noticeId);
    };
  }, [userId, ready]);

  useEffect(() => {
    const epoch = generation;
    const current = ++epoch.current;
    if (!userId || !activity || !ready) return;
    const savedUserId = userId;
    const savedActivity = activity;
    const reconnect = () => setAttempt((value) => value + 1);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', reconnect);
    async function load() {
      try {
        let savedTopics: Array<Topic & { bookmarkedAt?: string }>;
        let nextCursor: string | null = null;
        let hasMissing = false;
        if (navigator.onLine) {
          try {
            const client = createClient();
            const { data: bookmarks, error: bookmarkError } = await client
              .from('bookmarks')
              .select('topic_id,created_at')
              .eq('user_id', savedUserId)
              .order('created_at', { ascending: false });
            if (bookmarkError) throw bookmarkError;
            // Reconcile the server snapshot with the latest queued local operation
            // for each topic. This keeps offline additions visible and prevents
            // pending removals from reappearing while the outbox is retrying.
            const effectiveBookmarks = new Map(
              (bookmarks ?? []).map((bookmark) => [
                String(bookmark.topic_id),
                { topic_id: String(bookmark.topic_id), created_at: bookmark.created_at },
              ])
            );
            const pendingChanges = await savedActivity.store.pendingChanges(savedUserId, 'bookmark');
            for (const change of pendingChanges) {
              if (change.value) {
                const existing = effectiveBookmarks.get(change.topicId);
                effectiveBookmarks.set(change.topicId, {
                  topic_id: change.topicId,
                  created_at: existing?.created_at ?? change.savedAt ?? new Date().toISOString(),
                });
              } else {
                effectiveBookmarks.delete(change.topicId);
              }
            }
            const orderedBookmarks = [...effectiveBookmarks.values()].sort((a, b) => {
              const dateDifference = Date.parse(b.created_at) - Date.parse(a.created_at);
              return Number.isNaN(dateDifference) || dateDifference === 0
                ? a.topic_id.localeCompare(b.topic_id)
                : dateDifference;
            });
            const ids = orderedBookmarks.map((bookmark) => String(bookmark.topic_id));
            // Cache authoritative server timestamps so the same labels survive an offline restart.
            try {
              await savedActivity.store.recordBookmarkTimestamps(
                savedUserId,
                (bookmarks ?? []).map((bookmark) => ({
                  topicId: String(bookmark.topic_id),
                  savedAt: bookmark.created_at,
                }))
              );
              clearNativeStatusNotice('bookmarks-cache:' + savedUserId);
            } catch (cacheError) {
              console.error('Unable to cache bookmark timestamps:', cacheError);
              notifyNativeStatus('Bookmark dates could not be saved for offline viewing.', {
                id: 'bookmarks-cache:' + savedUserId,
              });
            }
            const { data: topicRows, error: topicsError } = ids.length
              ? await client
                  .from('topics')
                  .select('id,slug,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(name,is_published)')
                  .in('id', ids)
                  .eq('is_published', true)
                  .eq('category.is_published', true)
              : { data: [], error: null };
            if (topicsError) throw topicsError;
            const mapped = new Map((topicRows ?? []).map((row) => {
              const relation = Array.isArray(row.category) ? row.category[0] : row.category;
              const topic: Topic = {
                id: row.id,
                slug: row.slug,
                category: relation?.name ?? '',
                question: row.question,
                answer: row.answer,
                explanation: row.explanation,
                catechism: { paragraphs: row.catechism_paragraphs ?? [], text: row.catechism_text },
                scripture: { reference: row.scripture_reference, text: row.scripture_text },
              };
              return [String(topic.id), topic] as const;
            }));
            savedTopics = orderedBookmarks.flatMap((bookmark) => {
              const topic = mapped.get(String(bookmark.topic_id));
              return topic ? [{ ...topic, bookmarkedAt: bookmark.created_at }] : [];
            });
            hasMissing = savedTopics.length !== orderedBookmarks.length;
            clearNativeStatusNotice('bookmarks-online:' + savedUserId);
          } catch (onlineError) {
            console.error('Unable to load live bookmarks:', onlineError);
            const page = await savedActivity.store.listActivity(savedUserId, 'bookmark');
            const offlineTopics = await catalogue.topicsByIds(page.topicIds);
            const savedAtById = new Map(page.items.map((item) => [item.topicId, item.savedAt]));
            savedTopics = offlineTopics.map((topic) => ({
              ...topic,
              bookmarkedAt: savedAtById.get(String(topic.id)) ?? undefined,
            }));
            nextCursor = page.nextCursor;
            hasMissing = offlineTopics.length !== page.topicIds.length;
            notifyNativeStatus('Live bookmarks are unavailable. Showing saved bookmarks from this device.', {
              id: 'bookmarks-online:' + savedUserId,
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        } else {
          const page = await savedActivity.store.listActivity(savedUserId, 'bookmark');
          const offlineTopics = await catalogue.topicsByIds(page.topicIds);
          const savedAtById = new Map(page.items.map((item) => [item.topicId, item.savedAt]));
          savedTopics = offlineTopics.map((topic) => ({
            ...topic,
            bookmarkedAt: savedAtById.get(String(topic.id)) ?? undefined,
          }));
          nextCursor = page.nextCursor;
          hasMissing = offlineTopics.length !== page.topicIds.length;
        }
        if (epoch.current !== current) return;
        setTopics(savedTopics);
        setCursor(nextCursor);
        setMissing(hasMissing);
        setError('');
        clearNativeStatusNotice('bookmarks:' + savedUserId);
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load saved bookmarks:', cause);
        if (epoch.current === current) {
          setError('Unable to load your bookmarks. Please try again.');
          notifyNativeStatus('Unable to load your bookmarks. Please try again.', {
            id: 'bookmarks:' + savedUserId,
            action: {
              label: 'Retry',
              onClick: () => {
                setError('');
                setLoading(true);
                setAttempt((value) => value + 1);
              },
            },
          });
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      epoch.current++;
      clearNativeStatusNotice('bookmarks:' + savedUserId);
      clearNativeStatusNotice('bookmarks-online:' + savedUserId);
      clearNativeStatusNotice('bookmarks-more:' + savedUserId);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', reconnect);
    };
  }, [catalogue, userId, activity, ready, version, attempt]);

  async function loadMore() {
    if (!cursor || !userId || !activity || busy.current) return;
    const current = generation.current;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await activity.store.listActivity(userId, 'bookmark', cursor);
      const offlineTopics = await catalogue.topicsByIds(page.topicIds);
      const savedAtById = new Map(page.items.map((item) => [item.topicId, item.savedAt]));
      const savedTopics = offlineTopics.map((topic) => ({
        ...topic,
        bookmarkedAt: savedAtById.get(String(topic.id)) ?? undefined,
      }));
      if (current !== generation.current) return;
      setTopics((previous) => [...previous, ...savedTopics]);
      setCursor(page.nextCursor);
      setMissing((previous) => previous || savedTopics.length !== page.topicIds.length);
    } catch (cause) {
      console.error('Unable to load more saved bookmarks:', cause);
      if (current === generation.current) {
        setError('Unable to load more bookmarks. Please try again.');
        notifyNativeStatus('Unable to load more bookmarks. Please try again.', {
          id: 'bookmarks-more:' + userId,
          action: { label: 'Retry', onClick: () => void loadMore() },
        });
      }
    } finally {
      busy.current = false;
      if (current === generation.current) setLoading(false);
    }
  }

  return (
    <div className="container py-12">
      <BookmarksHeader
        count={ready && !loading && !error && !cursor && !missing ? topics.length : undefined}
      />
      {!userId ? (
        <p>
          Sign in to see your bookmarks.{' '}
          <Link className="text-accent underline" href="/signin">
            Sign in
          </Link>
        </p>
      ) : !ready ? (
        <p role="status">Preparing your saved bookmarks...</p>
      ) : (
        <>
          {loading && !topics.length && <p role="status">Loading bookmarks…</p>}

          {missing && (
            <p role="status" className="text-text-secondary mb-6">
              Some saved topics are not available on this device yet.
            </p>
          )}
          {!loading && !error && !topics.length && !missing && <EmptyBookmarks />}
          {topics.length > 0 && <BookmarksGrid topics={topics} />}
          {cursor && !error && (
            <button
              type="button"
              className="text-accent mt-8"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {loading ? 'Loading…' : 'Load more bookmarks'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
