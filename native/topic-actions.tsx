import { useEffect, useRef, useState } from 'react';
import { Bookmark, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { siteConfig } from '@/lib/constants';
import type { Topic } from '@/types';
import type { NativeActivity, NativeActivityStatus } from './activity';

export function NativeTopicActions({
  topic,
  userId,
  activity,
  status,
  version,
}: {
  topic: Topic;
  userId: string | null;
  activity: NativeActivity | null;
  status: NativeActivityStatus | null;
  version: number;
}) {
  const [bookmark, setBookmark] = useState<{ userId: string; value: boolean } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const requestSignIn = useSignInPrompt();
  const ready = Boolean(
    userId && activity?.userId === userId && status?.userId === userId && status.ready
  );

  useEffect(() => {
    let active = true;
    if (!userId || !activity || !ready) return;
    activity.store.topicActivity(userId, String(topic.id)).then(
      (saved) => {
        if (active) {
          setBookmark({ userId, value: saved.bookmarked });
          setError('');
        }
      },
      (cause: unknown) => {
        console.error('Unable to load saved bookmark:', cause);
        if (active) setError('Unable to load your bookmark. Please try again.');
      }
    );
    return () => {
      active = false;
    };
  }, [activity, userId, ready, topic.id, version, attempt]);

  const saved = userId && bookmark?.userId === userId ? bookmark.value : null;

  async function toggleBookmark() {
    if (!userId) {
      requestSignIn('save bookmarks');
      return;
    }
    if (!activity || !ready || saved === null || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      await activity.set(String(topic.id), 'bookmark', !saved);
      setBookmark({ userId, value: !saved });
    } catch (cause) {
      console.error('Unable to save bookmark:', cause);
      setError('Unable to update your bookmark. Please try again.');
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  async function share() {
    setMessage('');
    try {
      const url = new URL(`/topic/${encodeURIComponent(topic.slug)}`, siteConfig.url).toString();
      if (navigator.share) {
        await navigator.share({ title: topic.question, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setMessage('Topic link copied.');
      } else {
        setMessage('Sharing is not available on this device.');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      console.error('Unable to share topic:', cause);
      setMessage('Unable to share this topic. Please try again.');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant={saved ? 'primary' : 'secondary'}
          onClick={() => void toggleBookmark()}
          disabled={loading || Boolean(userId && (!ready || saved === null))}
          style={saved ? { color: '#ffffff' } : undefined}
        >
          <Bookmark className={`mr-2 h-4 w-4 ${saved ? 'fill-current' : ''}`} />
          {saved ? 'Bookmarked' : 'Bookmark Topic'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void share()}>
          <Share2 className="mr-2 h-4 w-4" /> Share Topic
        </Button>
      </div>
      {userId && !ready && (
        <p role="status" className="text-text-secondary mt-3 text-sm">
          {status?.userId === userId && status.error
            ? status.error
            : 'Connect to set up your saved account activity on this device.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="text-text-secondary mt-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
