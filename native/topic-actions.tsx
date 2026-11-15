import { useEffect, useRef, useState } from 'react';
import { Bookmark, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { siteConfig } from '@/lib/constants';
import type { Topic } from '@/types';
import type { NativeActivity, NativeActivityStatus } from './activity';

type TopicIdentity = { userId: string; topicId: string };

function identityKey(identity: TopicIdentity): string {
  return JSON.stringify([identity.userId, identity.topicId]);
}

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
  const topicId = String(topic.id);
  const identity = userId ? { userId, topicId } : null;
  const key = identity ? identityKey(identity) : '';
  const [bookmark, setBookmark] = useState<{ userId: string; topicId: string; value: boolean } | null>(null);
  const [errorState, setErrorState] = useState<{ userId: string; topicId: string; value: string } | null>(null);
  const [message, setMessage] = useState('');
  const [pendingState, setPendingState] = useState<Record<string, true>>({});
  const pendingKeys = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const requestSignIn = useSignInPrompt();
  const ready = Boolean(
    userId && activity?.userId === userId && status?.userId === userId && status.ready
  );
  const loading = Boolean(key && pendingState[key]);
  const error = identity && errorState?.userId === identity.userId && errorState.topicId === identity.topicId
    ? errorState.value
    : '';

  useEffect(() => {
    let active = true;
    if (!userId || !activity || !ready) return;
    const target = { userId, topicId };
    activity.store.topicActivity(target.userId, target.topicId).then(
      (saved) => {
        if (active) {
          setBookmark({ ...target, value: saved.bookmarked });
          setErrorState({ ...target, value: '' });
        }
      },
      (cause: unknown) => {
        console.error('Unable to load saved bookmark:', cause);
        if (active) {
          setErrorState({ ...target, value: 'Unable to load your bookmark. Please try again.' });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [activity, userId, ready, topicId, version, attempt]);

  const saved =
    identity && bookmark?.userId === identity.userId && bookmark.topicId === identity.topicId
      ? bookmark.value
      : null;

  async function toggleBookmark() {
    if (!userId) {
      requestSignIn('save bookmarks');
      return;
    }
    const target = { userId, topicId };
    const targetKey = identityKey(target);
    const targetActivity = activity;
    if (!targetActivity || !ready || saved === null || pendingKeys.current.has(targetKey)) return;

    pendingKeys.current.add(targetKey);
    setPendingState((previous) => ({ ...previous, [targetKey]: true }));
    setErrorState({ ...target, value: '' });
    try {
      await targetActivity.set(target.topicId, 'bookmark', !saved);
      setBookmark({ ...target, value: !saved });
    } catch (cause) {
      console.error('Unable to save bookmark:', cause);
      setErrorState({ ...target, value: 'Unable to update your bookmark. Please try again.' });
    } finally {
      pendingKeys.current.delete(targetKey);
      setPendingState((previous) => {
        if (!previous[targetKey]) return previous;
        const next = { ...previous };
        delete next[targetKey];
        return next;
      });
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
