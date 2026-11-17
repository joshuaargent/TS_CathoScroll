import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface TopicCardLayoutProps {
  header: ReactNode;
  children: ReactNode;
  progress?: ReactNode;
  footer?: ReactNode;
  className?: string;
  cardClassName?: string;
  contentClassName?: string;
  contentWidthClassName?: string;
}

export function TopicCardLayout({
  header,
  children,
  progress,
  footer,
  className,
  cardClassName,
  contentClassName,
  contentWidthClassName = 'max-w-3xl',
}: TopicCardLayoutProps) {
  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      {progress && (
        <div className="shrink-0 px-6 pt-6 md:px-8 md:pt-8">
          {progress}
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col px-6 pb-6 md:px-8 md:pb-8', cardClassName)}>
        <header className="flex items-center justify-between gap-3">
          {header}
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className={cn('mx-auto w-full text-center', contentWidthClassName, contentClassName)}>
            {children}
          </div>
        </div>

        {footer && <footer className="shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}
