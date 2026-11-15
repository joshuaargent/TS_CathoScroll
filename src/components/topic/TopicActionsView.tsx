import { Bookmark, Share2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';

export function TopicActionsView({
  isBookmarked,
  bookmarkDisabled,
  bookmarkError = '',
  statusMessage = '',
  shareMessage = '',
  onToggleBookmark,
  onRetryBookmark,
  onShare,
}: {
  isBookmarked: boolean;
  bookmarkDisabled: boolean;
  bookmarkError?: string;
  statusMessage?: string;
  shareMessage?: string;
  onToggleBookmark: () => void;
  onRetryBookmark?: () => void;
  onShare: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant={isBookmarked ? 'primary' : 'secondary'}
          onClick={onToggleBookmark}
          disabled={bookmarkDisabled}
          style={isBookmarked ? { color: '#ffffff' } : undefined}
        >
          <Bookmark className={`mr-2 h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
          {isBookmarked ? 'Bookmarked' : 'Bookmark Topic'}
        </Button>
        <Button type="button" variant="secondary" onClick={onShare}>
          <Share2 className="mr-2 h-4 w-4" />
          Share Topic
        </Button>
      </div>
      {statusMessage && (
        <p role="status" className="text-text-secondary mt-3 text-sm">
          {statusMessage}
        </p>
      )}
      {bookmarkError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {bookmarkError}{' '}
          {onRetryBookmark && (
            <button type="button" className="underline" onClick={onRetryBookmark}>
              Retry
            </button>
          )}
        </p>
      )}
      {shareMessage && (
        <p role="status" className="text-text-secondary mt-3 text-sm">
          {shareMessage}
        </p>
      )}
    </div>
  );
}
