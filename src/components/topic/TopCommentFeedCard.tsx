'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { DoorOpen, Heart, MessageCircle } from 'lucide-react';

import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { createClient } from '@/lib/supabase/client';
import type { TopFeedComment } from '@/lib/feed-comments';
import { cn } from '@/lib/utils';
import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { BaseFeedCard } from './BaseFeedCard';
import { flushFeedCardAnalytics, installFeedCardAnalyticsListeners, recordFeedCardAnalyticsEvent } from '@/lib/feed-card-analytics-client';
import { recordAnonymousFeedEvent } from '@/lib/anonymous-feed-analytics-client';

interface TopCommentFeedCardProps {
  comments: TopFeedComment[];
  userId: string | null;
  previewMode?: boolean;
  active?: boolean;
  onNextTopic: () => void | boolean | Promise<void | boolean>;
  onPreviousTopic: () => void;
  onOpenComment: (comment: TopFeedComment) => void;
  onCommentViewed: (commentId: number) => void;
  initialActiveIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onProgressChange: (current: number, total: number) => void;
  nextEntryPreview?: ReactNode;
  previousEntryPreview?: ReactNode;
  analyticsEndpoint?: string;
  getAnalyticsAccessToken?: () => Promise<string | null>;
}

function CommentLikeControl({
  comment,
  userId,
  previewMode,
}: {
  comment: TopFeedComment;
  userId: string | null;
  previewMode: boolean;
}) {
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(comment.like_count);
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState('');
  const requestSignIn = useSignInPrompt();

  useEffect(() => {
    if (!userId || previewMode) return;

    let cancelled = false;
    void createClient()
      .from('comment_likes')
      .select('comment_id')
      .eq('comment_id', comment.comment_id)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLikeError('Like status is temporarily unavailable.');
          return;
        }
        setIsLiked(Boolean(data));
      });

    return () => {
      cancelled = true;
    };
  }, [comment.comment_id, previewMode, userId]);

  const toggleLike = async () => {
    if (likePending || previewMode) return;
    if (!userId) {
      requestSignIn('like comments');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setLikeError('Connect to the internet to like this comment.');
      return;
    }

    setLikeError('');
    setLikePending(true);
    const wasLiked = isLiked;
    setIsLiked(!wasLiked);
    setLikeCount((count) => Math.max(0, count + (wasLiked ? -1 : 1)));

    try {
      const supabase = createClient();
      const result = wasLiked
        ? await supabase
            .from('comment_likes')
            .delete()
            .eq('user_id', userId)
            .eq('comment_id', comment.comment_id)
        : await supabase.from('comment_likes').insert({
            user_id: userId,
            comment_id: comment.comment_id,
          });

      if (result.error) throw result.error;
    } catch (error) {
      setIsLiked(wasLiked);
      setLikeCount((count) => Math.max(0, count + (wasLiked ? 1 : -1)));
      setLikeError(
        error && typeof error === 'object' && 'code' in error && error.code === 'P0001'
          ? 'You have reached the comment-like limit. Please try again later.'
          : 'Unable to update your like. Please try again.'
      );
    } finally {
      setLikePending(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={() => void toggleLike()}
        disabled={likePending || previewMode}
        aria-label={isLiked ? 'Unlike comment' : 'Like comment'}
        aria-pressed={isLiked}
        className={cn(
          'text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 items-center gap-2 rounded-full px-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          isLiked && 'bg-accent-light text-accent'
        )}
      >
        <Heart className={cn('h-5 w-5', isLiked && 'fill-current')} />
        <span className="text-xs font-medium tabular-nums">{likeCount}</span>
      </button>
      {likeError && <span role="status" className="sr-only">{likeError}</span>}
    </div>
  );
}

export function TopCommentFeedCard({
  comments,
  userId,
  previewMode = false,
  active = true,
  onNextTopic,
  onPreviousTopic,
  onOpenComment,
  onCommentViewed,
  initialActiveIndex = 0,
  onActiveIndexChange,
  onProgressChange,
  nextEntryPreview,
  previousEntryPreview,
  analyticsEndpoint,
  getAnalyticsAccessToken,
}: TopCommentFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const navigationStarted = useRef(false);
  const commentArticleRef = useRef<HTMLElement | null>(null);

  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, comments.length - 1));
  const comment = comments[safeIndex];
  const activeCommentId = comment?.comment_id;

  useLayoutEffect(() => {
    if (active && !previewMode) onProgressChange(safeIndex, comments.length);
  }, [active, comments.length, onProgressChange, previewMode, safeIndex]);

  useEffect(() => {
    if (active) navigationStarted.current = false;
  }, [active, comments]);

  useEffect(() => {
    if (!active || !userId || previewMode) return;
    return installFeedCardAnalyticsListeners(userId, {
      endpoint: analyticsEndpoint,
      getAccessToken: getAnalyticsAccessToken,
    });
  }, [active, analyticsEndpoint, getAnalyticsAccessToken, previewMode, userId]);

  useEffect(() => {
    if (active && !previewMode && activeCommentId !== undefined) onCommentViewed(activeCommentId);
  }, [active, activeCommentId, onCommentViewed, previewMode]);

  useEffect(() => {
    if (!active || previewMode || userId || activeCommentId === undefined) return;
    recordAnonymousFeedEvent('comment', activeCommentId, 'impression');
    let isIntersecting = false;
    let viewable = false;
    let viewTimer: ReturnType<typeof setTimeout> | null = null;
    let durationTimer: ReturnType<typeof setInterval> | null = null;
    let startedAt: number | null = null;
    let activeMilliseconds = 0;

    const flushDuration = () => {
      if (startedAt === null) return;
      const elapsed = Math.max(0, Math.round(Date.now() - startedAt));
      startedAt = null;
      if (elapsed > 0) {
        activeMilliseconds += elapsed;
        recordAnonymousFeedEvent('comment', activeCommentId, 'active_duration', elapsed);
      }
    };
    const startDuration = () => {
      if (!viewable || document.visibilityState !== 'visible' || startedAt !== null) return;
      startedAt = Date.now();
      if (durationTimer === null) durationTimer = setInterval(() => flushDuration(true), 5000);
    };
    const scheduleViewability = () => {
      if (!isIntersecting || viewable || viewTimer !== null || document.visibilityState !== 'visible') return;
      viewTimer = setTimeout(() => {
        viewTimer = null;
        if (!isIntersecting || document.visibilityState !== 'visible') return;
        viewable = true;
        recordAnonymousFeedEvent('comment', activeCommentId, 'viewable_impression');
        startDuration();
      }, 1000);
    };
    const observer = typeof IntersectionObserver !== 'undefined' && commentArticleRef.current
      ? new IntersectionObserver((entries) => {
          const entry = entries[0];
          isIntersecting = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
          if (isIntersecting) scheduleViewability();
          else {
            if (viewTimer !== null) clearTimeout(viewTimer);
            viewTimer = null;
            flushDuration(false);
          }
        }, { threshold: [0, 0.5, 1] })
      : null;
    if (commentArticleRef.current && observer) observer.observe(commentArticleRef.current);
    else {
      isIntersecting = true;
      scheduleViewability();
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (viewTimer !== null) clearTimeout(viewTimer);
        viewTimer = null;
        flushDuration(false);
      } else if (isIntersecting) {
        if (viewable) startDuration();
        else scheduleViewability();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (viewTimer !== null) clearTimeout(viewTimer);
      flushDuration();
      if (durationTimer !== null) clearInterval(durationTimer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (activeMilliseconds < 3000) recordAnonymousFeedEvent('comment', activeCommentId, 'skip');
      else recordAnonymousFeedEvent('comment', activeCommentId, 'completion');
    };
  }, [active, activeCommentId, previewMode, userId]);

  useEffect(() => {
    if (!active || previewMode || !userId || activeCommentId === undefined) return;
    recordFeedCardAnalyticsEvent(userId, 'impression', activeCommentId);
    let viewable = false;
    let viewableImpressionRecorded = false;
    let isIntersecting = false;
    let viewableTimer: ReturnType<typeof setTimeout> | null = null;
    let durationTimer: ReturnType<typeof setInterval> | null = null;
    let activeMilliseconds = 0;
    let startedAt = Date.now();
    const startDuration = () => {
      if (!viewable || document.visibilityState !== 'visible' || durationTimer) return;
      startedAt = Date.now();
      durationTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        activeMilliseconds += elapsed;
        startedAt = Date.now();
        recordFeedCardAnalyticsEvent(userId, 'active_duration', activeCommentId, elapsed);
      }, 5000);
    };
    const stopDuration = () => {
      if (!durationTimer) return;
      clearInterval(durationTimer);
      durationTimer = null;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 0) {
        activeMilliseconds += elapsed;
        recordFeedCardAnalyticsEvent(userId, 'active_duration', activeCommentId, elapsed);
      }
    };
    const scheduleViewability = () => {
      if (!isIntersecting || viewable || viewableTimer || document.visibilityState !== 'visible') return;
      viewableTimer = setTimeout(() => {
        viewableTimer = null;
        if (!isIntersecting || document.visibilityState !== 'visible') return;
        viewable = true;
        if (!viewableImpressionRecorded) {
          viewableImpressionRecorded = true;
          recordFeedCardAnalyticsEvent(userId, 'viewable_impression', activeCommentId);
        }
        startDuration();
      }, 1000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (viewableTimer) clearTimeout(viewableTimer);
        viewableTimer = null;
        stopDuration();
      } else if (viewable) {
        startDuration();
      } else {
        scheduleViewability();
      }
    };
    const observer = typeof IntersectionObserver !== 'undefined' && commentArticleRef.current
      ? new IntersectionObserver((entries) => {
          const entry = entries[0];
          isIntersecting = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
          if (!isIntersecting) {
            if (viewableTimer) clearTimeout(viewableTimer);
            viewableTimer = null;
            stopDuration();
            viewable = false;
            return;
          }
          scheduleViewability();
        }, { threshold: [0, 0.5, 1] })
      : null;
    if (commentArticleRef.current && observer) observer.observe(commentArticleRef.current);
    else {
      isIntersecting = true;
      scheduleViewability();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (viewableTimer) clearTimeout(viewableTimer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      stopDuration();
      if (activeMilliseconds < 3000) recordFeedCardAnalyticsEvent(userId, 'skip', activeCommentId);
      else recordFeedCardAnalyticsEvent(userId, 'completion', activeCommentId);
      void flushFeedCardAnalytics(userId, true);
    };
  }, [active, activeCommentId, previewMode, userId]);

  if (!comment) return null;

  const openComment = () => {
    if (userId) recordFeedCardAnalyticsEvent(userId, 'open', comment.comment_id);
    else if (!previewMode) recordAnonymousFeedEvent('comment', comment.comment_id, 'open');
    onOpenComment(comment);
  };

  const navigateNextTopic = async () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    try {
      if (await onNextTopic() === false) navigationStarted.current = false;
    } catch (error) {
      navigationStarted.current = false;
      throw error;
    }
  };

  const navigatePreviousTopic = () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    onPreviousTopic();
  };

  const commentContentClasses = comment.content.length > 360
    ? 'text-lg md:text-xl'
    : comment.content.length > 180
      ? 'text-xl md:text-2xl'
      : 'text-2xl md:text-4xl';

  const updateActiveIndex = (index: number) => {
    const nextIndex = Math.min(Math.max(0, index), comments.length - 1);
    setActiveIndex(nextIndex);
    onActiveIndexChange?.(nextIndex);
  };
  const showPreviousComment = () => updateActiveIndex(safeIndex - 1);
  const showNextComment = () => updateActiveIndex(safeIndex + 1);

  const renderCommentPreview = (previewComment: TopFeedComment | undefined) => {
    if (!previewComment) return null;
    const previewTextClasses = previewComment.content.length > 360
      ? 'text-lg md:text-xl'
      : previewComment.content.length > 180
        ? 'text-xl md:text-2xl'
        : 'text-2xl md:text-4xl';

    return (
      <BaseFeedCard
        className="bg-accent-light/5"
        contentWidthClassName="max-w-3xl"
        title={<span className="text-text-muted text-xs tracking-wider uppercase">Top Comments</span>}
      >
        <article ref={commentArticleRef} className="w-full">
          <p className="text-text-muted mb-5 text-sm font-medium md:text-base">
            {previewComment.topic_question}
          </p>
          <p className={cn('text-text-primary leading-tight font-semibold', previewTextClasses)}>
            {previewComment.content}
            {previewComment.content_truncated ? '…' : ''}
          </p>
          <div className="mt-6 flex items-center justify-center">
            <span className="text-text-muted text-sm font-medium">
              {previewComment.author_display_name}
              {previewComment.author_username ? (
                <span className="ml-2 font-normal">@{previewComment.author_username}</span>
              ) : null}
            </span>
          </div>
        </article>
      </BaseFeedCard>
    );
  };

  return (
    <FeedInterstitialMotion
      ariaLabel="Top community comments"
      active={active}
      onSwipeLeft={showNextComment}
      onSwipeRight={showPreviousComment}
      canSwipeLeft={() => safeIndex < comments.length - 1}
      canSwipeRight={() => safeIndex > 0}
      onNextTopic={navigateNextTopic}
      onPreviousTopic={navigatePreviousTopic}
      nextPreview={nextEntryPreview}
      previousPreview={previousEntryPreview}
      previousHorizontalPreview={renderCommentPreview(comments[safeIndex - 1])}
      nextHorizontalPreview={renderCommentPreview(comments[safeIndex + 1])}
    >
      <BaseFeedCard
        className="bg-accent-light/5"
        contentWidthClassName="max-w-3xl"
        title={<span className="text-text-muted text-xs tracking-wider uppercase">Top Comments</span>}
        actions={
          <>
              <CommentLikeControl
                key={comment.comment_id}
                comment={comment}
                userId={userId}
                previewMode={previewMode}
              />
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={openComment}
                aria-label={`Open ${comment.reply_count} replies`}
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 items-center gap-2 rounded-full px-4 transition-colors"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="text-xs font-medium tabular-nums">{comment.reply_count}</span>
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={openComment}
                aria-label="See more about this comment"
                title="See more"
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 w-11 items-center justify-center rounded-full transition-colors"
              >
                <DoorOpen className="h-5 w-5" />
              </button>

          </>
        }
      >
        <article
          className="w-full"
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) return;
            openComment();
          }}
          aria-label="Community comment. Double-click to open the discussion."
        >
          <p className="text-text-muted mb-5 text-sm font-medium md:text-base">
            {comment.topic_question}
          </p>
          <p className={cn('text-text-primary leading-tight font-semibold', commentContentClasses)}>
            {comment.content}
            {comment.content_truncated ? '…' : ''}
          </p>
          <div className="mt-6 flex items-center justify-center">
            {comment.author_username ? (
              <Link
                href={`/profile/${encodeURIComponent(comment.author_username)}`}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                className="text-text-muted hover:text-text-primary text-sm font-medium transition-colors"
              >
                {comment.author_display_name}
                <span className="ml-2 font-normal">@{comment.author_username}</span>
              </Link>
            ) : (
              <span className="text-text-muted text-sm font-medium">{comment.author_display_name}</span>
            )}
          </div>
        </article>
      </BaseFeedCard>
    </FeedInterstitialMotion>
  );
}
