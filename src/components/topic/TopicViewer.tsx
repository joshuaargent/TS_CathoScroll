'use client';

import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Topic } from '@/types';
import { loadTopicActivity, type TopicActivity } from '@/lib/topic-activity';

import { TopicSwipeViewer } from './TopicSwipeViewer';

interface TopicViewerProps {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;

  onNextTopic?: () => void;
  onPreviousTopic?: () => void;
}

export function TopicViewer({
  topics,
  topicIndex,
  initialUserId,
  onNextTopic,
  onPreviousTopic,
}: TopicViewerProps) {
  const router = useRouter();
  const requestSignIn = useSignInPrompt();

  const supabase = useMemo(() => createClient(), []);

  const currentTopic = topics[topicIndex];
  const currentTopicId = String(currentTopic.id);

  const [userId, setUserId] = useState(initialUserId);
  const [activity, setActivity] = useState<TopicActivity | null>(null);
  const [activityError, setActivityError] = useState<{
    topicId: string;
    userId: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pendingActions, setPendingActions] = useState(() => new Set<string>());
  const pendingRef = useRef(new Set<string>());

  const currentActivity =
    activity?.topicId === currentTopicId && activity.userId === userId ? activity : null;
  const currentActivityError =
    activityError?.topicId === currentTopicId && activityError.userId === userId;

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let active = true;

    // Discard the previous selection before actions can use stale user state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivity(null);
    setActivityError(null);

    async function loadActivity() {
      try {
        const result = await loadTopicActivity(supabase, currentTopicId, userId);
        if (active) {
          setActivity(result);
          setActivityError(null);
        }
      } catch (error) {
        console.error('Unable to load topic activity:', error);
        if (active) {
          setActivity(null);
          setActivityError({ topicId: currentTopicId, userId });
        }
      }
    }

    void loadActivity();
    return () => {
      active = false;
    };
  }, [supabase, currentTopicId, userId, refreshVersion]);

  async function mutateActivity(
    action: 'like' | 'bookmark' | 'progress',
    topicId: string,
    actorId: string,
    mutation: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    const key = `${action}:${topicId}`;
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingActions(new Set(pendingRef.current));
    setActionError('');

    try {
      const { error } = await mutation();
      if (error) throw new Error(error.message);

      // Reload after the write so a late read cannot overwrite its result.
      setActivity((previous) =>
        previous?.topicId === topicId && previous.userId === actorId ? null : previous
      );
      setRefreshVersion((previous) => previous + 1);
    } catch (error) {
      console.error(`Unable to update topic ${action}:`, error);
      setActionError(
        `Unable to update ${action === 'progress' ? 'your progress' : `your ${action}`}. Please try again.`
      );
    } finally {
      pendingRef.current.delete(key);
      setPendingActions(new Set(pendingRef.current));
    }
  }

  const toggleLike = async () => {
    if (!userId) {
      requestSignIn('like topics');

      return;
    }

    if (!currentActivity) return;

    await mutateActivity('like', currentTopicId, userId, () =>
      currentActivity.liked
        ? supabase.from('topic_likes').delete().eq('user_id', userId).eq('topic_id', currentTopicId)
        : supabase.from('topic_likes').insert({ user_id: userId, topic_id: currentTopicId })
    );
  };

  const toggleBookmark = async () => {
    if (!userId) {
      requestSignIn('save bookmarks');
      return;
    }

    if (!currentActivity) return;

    await mutateActivity('bookmark', currentTopicId, userId, () =>
      currentActivity.bookmarked
        ? supabase.from('bookmarks').delete().eq('user_id', userId).eq('topic_id', currentTopicId)
        : supabase.from('bookmarks').insert({ user_id: userId, topic_id: currentTopicId })
    );
  };

  const openComments = () => {
    router.push(`/topic/${currentTopic.slug}#comments`);
  };

  const shareTopic = async () => {
    try {
      const url =
        typeof window !== 'undefined' ? `${window.location.origin}/topic/${currentTopic.slug}` : '';

      if (navigator.share) {
        await navigator.share({
          title: currentTopic.question,
          url,
        });

        return;
      }

      await navigator.clipboard.writeText(url);
    } catch {}
  };

  const markCompleted = async (topicId: string) => {
    if (!userId) {
      return;
    }

    if (currentActivity?.topicId === topicId && currentActivity.completed) {
      return;
    }

    await mutateActivity('progress', topicId, userId, () =>
      supabase
        .from('progress')
        .upsert({ user_id: userId, topic_id: topicId }, { onConflict: 'user_id,topic_id' })
    );
  };

  return (
    <TopicSwipeViewer
      topics={topics}
      topicIndex={topicIndex}
      userId={userId}
      currentActivity={currentActivity}
      currentActivityError={Boolean(currentActivityError)}
      actionError={actionError}
      pendingActions={pendingActions}
      retryActivity={() => setRefreshVersion((previous) => previous + 1)}
      onLike={() => void toggleLike()}
      onDoubleTapLike={() => void toggleLike()}
      onBookmark={() => void toggleBookmark()}
      onComments={openComments}
      onShare={() => void shareTopic()}
      onComplete={(topicId) => void markCompleted(topicId)}
      onNextTopic={onNextTopic}
      onPreviousTopic={onPreviousTopic}
    />
  );
}
