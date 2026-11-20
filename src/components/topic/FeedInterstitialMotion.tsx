'use client';

import type { ReactNode } from 'react';
import { FeedSwipeViewport } from './FeedSwipeViewport';
import type { TopicSwipeDirection } from './useTopicSwipeGesture';

interface FeedInterstitialMotionProps {
  children: ReactNode;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  canSwipeLeft?: () => boolean;
  canSwipeRight?: () => boolean;
  onNextTopic: () => void | Promise<void>;
  onPreviousTopic: () => void | Promise<void>;
  ariaLabel: string;
  active?: boolean;
  nextPreview?: ReactNode;
  previousPreview?: ReactNode;
  nextHorizontalPreview?: ReactNode;
  previousHorizontalPreview?: ReactNode;
}

/**
 * Compatibility adapter for comment and sponsor renderers.
 *
 * All positioning, gestures and transitions are owned by FeedSwipeViewport,
 * the same five-position renderer used by TopicSwipeViewer. This component
 * only maps the legacy left/right callback names to feed directions.
 */
export function FeedInterstitialMotion({
  children,
  onSwipeLeft,
  onSwipeRight,
  canSwipeLeft,
  canSwipeRight,
  onNextTopic,
  onPreviousTopic,
  ariaLabel,
  active = true,
  nextPreview,
  previousPreview,
  nextHorizontalPreview,
  previousHorizontalPreview,
}: FeedInterstitialMotionProps) {
  const canSwipe = (direction: TopicSwipeDirection) => direction === 'next'
    ? (!canSwipeLeft || canSwipeLeft())
    : (!canSwipeRight || canSwipeRight());

  return (
    <FeedSwipeViewport
      active={active}
      ariaLabel={ariaLabel}
      role="region"
      tabIndex={0}
      containerClassName="h-full w-full overflow-hidden"
      motionClassName="relative h-full w-full transform-gpu will-change-transform select-none"
      canSwipeHorizontal={canSwipe}
      onSwipeHorizontal={(direction) => direction === 'next' ? onSwipeLeft() : onSwipeRight()}
      onSwipeVertical={(direction) => direction === 'next' ? onNextTopic() : onPreviousTopic()}
      topPreview={previousPreview}
      leftPreview={previousHorizontalPreview}
      rightPreview={nextHorizontalPreview}
      bottomPreview={nextPreview}
    >
      {children}
    </FeedSwipeViewport>
  );
}
