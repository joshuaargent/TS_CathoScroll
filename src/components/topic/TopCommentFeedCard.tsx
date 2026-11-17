'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, Heart, MessageCircle, Pin } from 'lucide-react';

import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { createClient } from '@/lib/supabase/client';
import type { TopFeedComment } from '@/lib/feed-comments';
import { cn } from '@/lib/utils';
import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { TopicCardLayout } from './TopicCardLayout';

interface TopCommentFeedCardProps {
  comments: TopFeedComment[];
  userId: string | null;
  previewMode?: boolean;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  onOpenComment: (comment: TopFeedComment) => void;
  onCommentViewed: (commentId: number) => void;
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
          'text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 items-center gap-2 rounded-full px-3 transition-colors disabled:opacity-50',
          isLiked && 'bg-accent-light text-accent'
        )}
      >
        <Heart className={cn('h-5 w-5', isLiked && 'fill-current')} />
        <span className="text-xs font-medium tabular-nums">{likeCount}</span>
      </button>
      {likeError && (
        <span role="status" className="text-text-muted max-w-48 text-right text-[10px] leading-tight">
          {likeError}
        </span>
      )}
    </div>
  );
}

export function TopCommentFeedCard({
  comments,
  userId,
  previewMode = false,
  onNextTopic,
  onPreviousTopic,
  onOpenComment,
  onCommentViewed,
}: TopCommentFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const navigationStarted = useRef(false);

  const safeIndex = Math.min(activeIndex, Math.max(0, comments.length - 1));
  const comment = comments[safeIndex];
  const activeCommentId = comment?.comment_id;

  useEffect(() => {
    if (activeCommentId !== undefined) onCommentViewed(activeCommentId);
  }, [activeCommentId, onCommentViewed]);

  if (!comment) return null;

  const openComment = () => onOpenComment(comment);

  const navigateNextTopic = () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    onNextTopic();
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

  const showPreviousComment = () => setActiveIndex((index) => Math.max(0, index - 1));
  const showNextComment = () => setActiveIndex((index) => Math.min(comments.length - 1, index + 1));

  return (
    <FeedInterstitialMotion
      ariaLabel="Top community comments"
      onSwipeLeft={showNextComment}
      onSwipeRight={showPreviousComment}
      canSwipeLeft={() => safeIndex < comments.length - 1}
      canSwipeRight={() => safeIndex > 0}
      onNextTopic={navigateNextTopic}
      onPreviousTopic={navigatePreviousTopic}
    >
      <TopicCardLayout
        className={safeIndex === 0 ? 'bg-accent-light/5' : undefined}
        contentWidthClassName="max-w-3xl"
        header={
          <>
            <p className="text-text-muted min-w-0 flex-1 truncate text-xs tracking-wider uppercase">
              Top Comments
            </p>
            <div className="flex shrink-0 items-center gap-1">
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
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 items-center gap-2 rounded-full px-3 transition-colors"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="text-xs font-medium tabular-nums">{comment.reply_count}</span>
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={openComment}
                aria-label="Open this comment"
                title="Open comment"
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 w-11 items-center justify-center rounded-full transition-colors"
              >
                <DoorOpen className="h-5 w-5" />
              </button>
            </div>
          </>
        }
        footer={
          <div className="flex flex-col items-center gap-3 pt-4">
            <div className="flex items-center justify-center pb-1">
              {comment.author_username ? (
                <Link
                  href={`/profile/${encodeURIComponent(comment.author_username)}`}
                  onClick={(event) => event.stopPropagation()}
                  className="text-text-primary hover:text-accent text-sm font-semibold transition-colors"
                >
                  {comment.author_display_name}
                  <span className="text-text-muted ml-2 font-normal">@{comment.author_username}</span>
                </Link>
              ) : (
                <span className="text-text-primary text-sm font-semibold">{comment.author_display_name}</span>
              )}
            </div>
            {comments.length > 1 && (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={showPreviousComment}
                  disabled={safeIndex === 0}
                  aria-label="Previous comment"
                  className="text-text-muted hover:bg-bg-secondary rounded-full p-2 transition-colors disabled:opacity-30"
                >
                  <span aria-hidden="true">←</span>
                </button>
                <span className="text-text-muted text-xs tabular-nums">
                  {safeIndex + 1} / {comments.length}
                </span>
                <button
                  type="button"
                  onClick={showNextComment}
                  disabled={safeIndex >= comments.length - 1}
                  aria-label="Next comment"
                  className="text-text-muted hover:bg-bg-secondary rounded-full p-2 transition-colors disabled:opacity-30"
                >
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </div>
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
          {comment.is_pinned && (
            <div className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent">
              <Pin className="h-3.5 w-3.5" />
              Pinned comment
            </div>
          )}
          <p className={cn('text-text-primary leading-tight font-semibold', commentContentClasses)}>
            {comment.content}
            {comment.content_truncated ? '…' : ''}
          </p>
        </article>
      </TopicCardLayout>
    </FeedInterstitialMotion>
  );
}
