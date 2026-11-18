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
  className?: string;
}

/**
 * Shared feed-card structure, matching the original TopicCard geometry:
 * one padded full-height column, a top header row, and a centred content row.
 * Topic-specific typography and actions remain owned by TopicCard; other
 * entry types supply their own title, actions, content and optional link.
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
  className,
}: BaseFeedCardProps) {
  return (
    <div className={cn('flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8', className, cardClassName)}>
      <div className="flex items-center justify-between">
        {header ?? (
          <>
            {title}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className={cn('mx-auto text-center', contentWidthClassName, contentClassName)}>
          {children}
          {link && <div className="mt-8 flex items-center justify-center">{link}</div>}
        </div>
      </div>

      {footer && <footer className="shrink-0">{footer}</footer>}
    </div>
  );
}
