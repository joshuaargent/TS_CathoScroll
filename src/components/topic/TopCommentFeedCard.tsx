'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { DoorOpen, Heart, MessageCircle, Pin } from 'lucide-react';

import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { createClient } from '@/lib/supabase/client';
import type { TopFeedComment } from '@/lib/feed-comments';
import { cn } from '@/lib/utils';

interface TopCommentFeedCardProps {
  comments: TopFeedComment[];
  userId: string | null;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  onOpenComment: (comment: TopFeedComment) => void;
  onCommentViewed: (commentId: number) => void;
}

export function TopCommentFeedCard({
  comments,
  userId,
  onNextTopic,
  onPreviousTopic,
  onOpenComment,
  onCommentViewed,
}: TopCommentFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState('');
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const navigationStarted = useRef(false);
  const likeRequestVersion = useRef(0);
  const { requestSignIn } = useSignInPrompt();

  const safeIndex = Math.min(activeIndex, Math.max(0, comments.length - 1));
  const comment = comments[safeIndex];
  const activeCommentId = comment?.comment_id;

  useEffect(() => {
    if (activeCommentId !== undefined) onCommentViewed(activeCommentId);
  }, [activeCommentId, onCommentViewed]);

  useEffect(() => {
    setIsLiked(false);
    setLikeCount(comment?.like_count ?? 0);
    setLikeError('');
    setLikePending(false);
    const requestVersion = ++likeRequestVersion.current;
    if (!comment || !userId) return;

    let cancelled = false;
    void createClient()
      .from('comment_likes')
      .select('comment_id')
      .eq('comment_id', comment.comment_id)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || likeRequestVersion.current !== requestVersion) return;
        if (error) {
          setLikeError('Like status is temporarily unavailable.');
          return;
        }
        setIsLiked(Boolean(data));
      });

    return () => {
      cancelled = true;
    };
  }, [comment?.comment_id, comment?.like_count, userId]);

  if (!comment) return null;

  const openComment = () => onOpenComment(comment);

  const toggleLike = async () => {
    if (likePending) return;
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

  const showPreviousComment = () => {
    setActiveIndex((index) => Math.max(0, index - 1));
  };

  const showNextComment = () => {
    setActiveIndex((index) => Math.min(comments.length - 1, index + 1));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 40) return;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) showNextComment();
      else showPreviousComment();
      return;
    }

    if (deltaY < 0) navigateNextTopic();
    else navigatePreviousTopic();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPreviousComment();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showNextComment();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateNextTopic();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigatePreviousTopic();
    } else if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      openComment();
    }
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col px-6 py-6 md:px-8 md:py-8',
        safeIndex === 0 && 'bg-accent-light/5'
      )}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onKeyDown={handleKeyDown}
      style={{ touchAction: 'none' }}
      tabIndex={0}
      role="region"
      aria-roledescription="feed card"
      aria-label="Top community comment"
    >
      <article
        className="flex min-h-0 flex-1 flex-col"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a')) return;
          openComment();
        }}
        aria-label="Community comment. Double-click to open the discussion."
      >
        <header className="flex items-center justify-between gap-3">
          <p className="text-text-muted min-w-0 flex-1 truncate text-xs tracking-wider uppercase">
            {comment.topic_question}
          </p>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={() => void toggleLike()}
              disabled={likePending}
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
        </header>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="mx-auto w-full max-w-3xl text-center">
            {comment.is_pinned && (
              <div className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                <Pin className="h-3.5 w-3.5" />
                Pinned comment
              </div>
            )}
            <p className="text-text-primary text-2xl leading-tight font-semibold md:text-4xl">
              {comment.content}
              {comment.content_truncated ? '…' : ''}
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-center pb-2">
          {comment.author_username ? (
            <Link
              href={`/profile/${encodeURIComponent(comment.author_username)}`}
              onClick={(event) => event.stopPropagation()}
              className="text-text-primary hover:text-accent text-sm font-semibold transition-colors"
            >
              {comment.author_display_name}
              <span className="text-text-muted ml-2 font-normal">
                @{comment.author_username}
              </span>
            </Link>
          ) : (
            <span className="text-text-primary text-sm font-semibold">
              {comment.author_display_name}
            </span>
          )}
        </footer>
      </article>

      {likeError && (
        <p role="status" className="text-text-muted pt-2 text-center text-xs">
          {likeError}
        </p>
      )}

      {comments.length > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
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
  );
}
