import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface TopicCardLayoutProps {
  header: ReactNode;
  children: ReactNode;
  progress?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  contentWidthClassName?: string;
}

export function TopicCardLayout({
  header,
  children,
  progress,
  footer,
  className,
  contentClassName,
  contentWidthClassName = 'max-w-3xl',
}: TopicCardLayoutProps) {
  return (
    <div className={cn('flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8', className)}>
      {progress && <div className="shrink-0 pb-5">{progress}</div>}
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
  );
}
