import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface BaseFeedCardProps {
  title: ReactNode;
  header?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  contentWidthClassName?: string;
  cardClassName?: string;
  link?: ReactNode;
  footer?: ReactNode;
  progress?: ReactNode;
  className?: string;
}

/**
 * Shared feed-card shell.
 *
 * Its geometry intentionally matches the original TopicCard: the header is
 * the first row, followed by a vertically and horizontally centred content
 * region. Keep these spacing classes stable; topic swipe previews render this
 * component several times around the active card.
 */
export function BaseFeedCard({
  title,
  header,
  actions,
  children,
  contentClassName,
  contentWidthClassName = 'max-w-3xl',
  cardClassName,
  link,
  footer,
  progress,
  className,
}: BaseFeedCardProps) {
  return (
    <div className={cn('bg-bg-primary flex h-full w-full flex-col', className)}>
      {progress && <div className="shrink-0 px-6 pt-4 pb-4">{progress}</div>}

      <div className={cn('flex min-h-0 flex-1 flex-col px-6 pt-6 pb-6 md:px-8 md:pt-8 md:pb-8', cardClassName)}>
      <header className="flex items-center justify-between">
        {header ?? (
          <>
            <div className="min-w-0">{title}</div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center">
        <div className={cn('mx-auto text-center', contentWidthClassName, contentClassName)}>
          {children}
          {link && <div className="mt-8 flex items-center justify-center">{link}</div>}
        </div>
      </div>

      {footer && <footer className="shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}
