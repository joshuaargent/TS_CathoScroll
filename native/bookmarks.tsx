import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { OfflineCatalogue } from '@/lib/offline/catalogue';
import type { Topic } from '@/types';
import type { NativeActivity, NativeActivityStatus } from './activity';

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
  const [topics, setTopics] = useState<Topic[]>([]);
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
    async function load() {
      try {
        const page = await savedActivity.store.listActivity(savedUserId, 'bookmark');
        const savedTopics = await catalogue.topicsByIds(page.topicIds);
        if (epoch.current !== current) return;
        setTopics(savedTopics);
        setCursor(page.nextCursor);
        setMissing(savedTopics.length !== page.topicIds.length);
        setError('');
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load saved bookmarks:', cause);
        if (epoch.current === current) {
          setError('Unable to load your bookmarks. Please try again.');
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      epoch.current++;
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
      if (current === generation.current)
        setError('Unable to load more bookmarks. Please try again.');
    } finally {
      busy.current = false;
      if (current === generation.current) setLoading(false);
    }
  }

  return (
    <div className="container py-12">
      <div className="mt-8 mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Bookmarks</h1>
        <p className="text-text-secondary mt-4 text-lg">Topics you&apos;ve saved for later.</p>
      </div>
      {!userId ? (
        <p>
          Sign in to see your bookmarks.{' '}
          <Link className="text-accent underline" href="/signin">
            Sign in
          </Link>
        </p>
      ) : !ready ? (
        <p role="status">
          {status?.userId === userId && status.error
            ? status.error
            : 'Connect to set up your saved account activity on this device.'}
        </p>
      ) : (
        <>
          {!navigator.onLine && (
            <p role="status" className="text-text-secondary mb-6">
              You&apos;re offline. Your saved changes will sync when you reconnect.
            </p>
          )}
          {loading && !topics.length && <p role="status">Loading bookmarks…</p>}
          {error && (
            <p role="alert">
              {error}{' '}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </button>
            </p>
          )}
          {missing && (
            <p role="status" className="text-text-secondary mb-6">
              Some saved topics are not available on this device yet.
            </p>
          )}
          {!loading && !error && !topics.length && !missing && (
            <p>No bookmarks yet. Save topics in the feed to see them here.</p>
          )}
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {topics.map((topic) => (
              <Link key={topic.id} href={`/topic/${encodeURIComponent(topic.slug)}`}>
                <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                  <Badge variant="accent" size="sm">
                    {topic.category}
                  </Badge>
                  <h2 className="mt-4 text-xl leading-tight font-bold">{topic.question}</h2>
                  <p className="text-text-secondary mt-3 line-clamp-3">{topic.answer}</p>
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
