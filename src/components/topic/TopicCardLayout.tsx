import type { ReactNode } from 'react';

import { BaseFeedCard } from './BaseFeedCard';

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

/**
 * Compatibility adapter for existing interstitial renderers.
 * All feed cards now share BaseFeedCard; new card implementations should use
 * its structured title/actions API directly.
 */
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
    <BaseFeedCard
      title={null}
      header={header}
      progress={progress}
      footer={footer}
      className={className}
      cardClassName={cardClassName}
      contentClassName={contentClassName}
      contentWidthClassName={contentWidthClassName}
    >
      {children}
    </BaseFeedCard>
  );
}
