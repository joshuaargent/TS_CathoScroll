import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { BookmarksHeader, EmptyBookmarks } from '@/components/bookmarks/BookmarksSummary';
import type { OfflineCatalogue } from '@/lib/offline/catalogue';
import type { Topic } from '@/types';
import { createClient } from './supabase';
import type { NativeActivity, NativeActivityStatus } from './activity';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

function formatSavedDate(dateString?: string) {
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
  return 'Saved ' + savedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
            const ids = (bookmarks ?? []).map((bookmark) => String(bookmark.topic_id));
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
            savedTopics = (bookmarks ?? []).flatMap((bookmark) => {
              const topic = mapped.get(String(bookmark.topic_id));
              return topic ? [{ ...topic, bookmarkedAt: bookmark.created_at }] : [];
            });
            hasMissing = savedTopics.length !== ids.length;
            clearNativeStatusNotice('bookmarks-online:' + savedUserId);
          } catch (onlineError) {
            console.error('Unable to load live bookmarks:', onlineError);
            const page = await savedActivity.store.listActivity(savedUserId, 'bookmark');
            const offlineTopics = await catalogue.topicsByIds(page.topicIds);
            savedTopics = offlineTopics;
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
          savedTopics = offlineTopics;
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
      const savedTopics = await catalogue.topicsByIds(page.topicIds);
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
        <p role="status">Connect to set up your saved account activity on this device.</p>
      ) : (
        <>
          {loading && !topics.length && <p role="status">Loading bookmarks…</p>}

          {missing && (
            <p role="status" className="text-text-secondary mb-6">
              Some saved topics are not available on this device yet.
            </p>
          )}
          {!loading && !error && !topics.length && !missing && <EmptyBookmarks />}
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {topics.map((topic) => (
              <Link key={topic.id} href={`/topic/${encodeURIComponent(topic.slug)}`}>
                <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                  <Badge variant="accent" size="sm">
                    {topic.category}
                  </Badge>
                  <h2 className="mt-4 text-xl leading-tight font-bold">{topic.question}</h2>
                  <p className="text-text-secondary mt-3 line-clamp-3">{topic.answer}</p>
                  {topic.bookmarkedAt && (
                    <p className="text-text-muted mt-6 text-sm">{formatSavedDate(topic.bookmarkedAt)}</p>
                  )}
                </article>
              </Link>
            ))}
          </div>
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
