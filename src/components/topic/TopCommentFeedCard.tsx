'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Pin, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import type { TopFeedComment } from '@/lib/feed-comments';

interface TopCommentFeedCardProps {
  comments: TopFeedComment[];
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  onOpenComment: (comment: TopFeedComment) => void;
  onCommentViewed: (commentId: number) => void;
}

export function TopCommentFeedCard({
  comments,
  onNextTopic,
  onPreviousTopic,
  onOpenComment,
  onCommentViewed,
}: TopCommentFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const safeIndex = Math.min(activeIndex, Math.max(0, comments.length - 1));
  const comment = comments[safeIndex];
  const activeCommentId = comment?.comment_id;

  useEffect(() => {
    if (activeCommentId !== undefined) onCommentViewed(activeCommentId);
  }, [activeCommentId, onCommentViewed]);

  if (!comment) return null;

  const showPreviousComment = () => {
    setActiveIndex(Math.max(0, safeIndex - 1));
  };

  const showNextComment = () => {
    setActiveIndex(Math.min(comments.length - 1, safeIndex + 1));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
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

    if (deltaY < 0) onNextTopic();
    else onPreviousTopic();
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
      onNextTopic();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onPreviousTopic();
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 pb-6"
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
      aria-label="Top community comments"
    >
      <header className="flex items-center justify-between gap-4 pt-4 pb-5">
        <div>
          <p className="text-accent text-xs font-semibold tracking-[0.16em] uppercase">
            Community
          </p>
          <h2 className="text-text-primary mt-1 text-xl font-bold">Top comments</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Recent discussion from across CathoScroll
          </p>
        </div>
        <span className="text-text-secondary rounded-full border px-3 py-1 text-sm tabular-nums">
          {safeIndex + 1} / {comments.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <article className="bg-bg-card border-border w-full rounded-3xl border p-6 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="bg-accent-light text-accent rounded-full px-3 py-1 text-xs font-semibold">
              {comment.category_name}
            </span>
            {comment.is_pinned && (
              <span className="text-text-secondary inline-flex items-center gap-1 text-xs">
                <Pin className="h-3.5 w-3.5" />
                Pinned in discussion
              </span>
            )}
          </div>

          <p className="text-text-secondary mb-3 text-sm leading-relaxed">
            On: {comment.topic_question}
          </p>
          <p className="text-text-primary line-clamp-8 text-lg leading-relaxed">
            {comment.content}
            {comment.content_truncated ? '…' : ''}
          </p>

          <div className="border-border mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-text-primary truncate font-semibold">
                {comment.author_display_name}
              </p>
              {comment.author_username && (
                <p className="text-text-muted truncate text-sm">@{comment.author_username}</p>
              )}
            </div>
            <div className="text-text-secondary flex shrink-0 items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <ThumbsUp className="h-4 w-4" />
                {comment.like_count}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4" />
                {comment.reply_count}
              </span>
            </div>
          </div>
        </article>

        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => onOpenComment(comment)}
          className="mt-4 w-full rounded-xl"
        >
          Open discussion
        </Button>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <button
          type="button"
          onClick={onPreviousTopic}
          className="border-border text-text-secondary hover:bg-bg-secondary inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous topic
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={showPreviousComment}
            disabled={safeIndex === 0}
            aria-label="Previous comment"
            className="border-border rounded-full border p-2 disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={showNextComment}
            disabled={safeIndex >= comments.length - 1}
            aria-label="Next comment"
            className="border-border rounded-full border p-2 disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onNextTopic}
          className="border-border text-text-secondary hover:bg-bg-secondary inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors"
        >
          Next topic
          <ChevronRight className="h-4 w-4" />
        </button>
      </footer>
      <p className="text-text-muted pt-3 text-center text-xs">
        Swipe horizontally to browse comments, or vertically to move through the feed
      </p>
    </div>
  );
}
