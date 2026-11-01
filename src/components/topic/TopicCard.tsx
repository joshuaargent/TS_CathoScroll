import { Bookmark, Heart, MessageCircle, Share2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface TopicCardProps {
  type: 'question' | 'answer' | 'explanation' | 'catechism' | 'scripture';

  title: string;

  content: string;

  reference?: string;

  onShare?: () => void;

  onBookmark?: () => void;

  onLike?: () => void;

  onComments?: () => void;

  likes?: number;

  comments?: number;

  isLiked?: boolean;

  isBookmarked?: boolean;
}

export function TopicCard({
  type,
  title,
  content,
  reference,
  onShare,
  onLike,
  onComments,
  likes = 0,
  comments = 0,
  isLiked = false,
  isBookmarked = false,
  onBookmark,
}: TopicCardProps) {
  const contentLength = content.length;

  const contentClasses = (() => {
    switch (type) {
      case 'question':
        if (contentLength < 60) {
          return 'text-5xl md:text-7xl font-extrabold';
        }

        if (contentLength < 100) {
          return 'text-4xl md:text-6xl font-extrabold';
        }

        return 'text-3xl md:text-5xl font-extrabold';

      case 'answer':
        return contentLength > 180
          ? 'text-lg md:text-xl font-semibold'
          : 'text-xl md:text-3xl font-semibold';

      case 'explanation':
        return contentLength > 300
          ? 'text-base md:text-lg font-medium'
          : 'text-lg md:text-xl font-medium';

      case 'catechism':
        return 'text-sm md:text-base';

      case 'scripture':
        return contentLength > 220 ? 'text-base md:text-lg italic' : 'text-lg md:text-xl italic';

      default:
        return 'text-lg';
    }
  })();

  return (
    <div
      className={cn(
        `flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8`,
        type === 'question' && 'bg-accent-light/5'
      )}
    >
      {/* Header */}

      <div className="flex items-center justify-between">
        <span className="text-text-muted text-xs tracking-wider uppercase">{title}</span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={onLike}
            className={cn(
              'flex h-11 items-center gap-2 rounded-full px-4 transition-colors',
              isLiked
                ? 'bg-accent-light text-accent'
                : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
            )}
          >
            <Heart className={cn('h-5 w-5', isLiked && 'fill-current')} />

            <span className="text-xs font-medium">{likes}</span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={onComments}
            className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 items-center gap-2 rounded-full px-4 transition-colors"
          >
            <MessageCircle className="h-5 w-5" />

            <span className="text-xs font-medium">{comments}</span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={onBookmark}
            aria-label="Bookmark topic"
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full transition-colors',
              isBookmarked
                ? 'bg-accent-light text-accent'
                : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
            )}
          >
            <Bookmark className={cn('h-5 w-5', isBookmarked && 'fill-current')} />
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={onShare}
            aria-label="Share topic"
            className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 w-11 items-center justify-center rounded-full transition-colors"
          >
            <Share2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}

      <div className="flex flex-1 items-center justify-center">
        <div className={cn('mx-auto text-center', type === 'question' ? 'max-w-2xl' : 'max-w-3xl')}>
          <div className={cn('text-text-primary leading-tight', contentClasses)}>{content}</div>

          {reference && (
            <div className="mt-8">
              <span className="bg-bg-secondary text-text-secondary border-border rounded-full border px-4 py-2 text-sm">
                {reference}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
