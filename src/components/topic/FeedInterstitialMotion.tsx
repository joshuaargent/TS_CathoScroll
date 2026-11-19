'use client';

import { animate, motion, useMotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useTopicSwipeGesture } from './useTopicSwipeGesture';

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
  const animationLockRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const move = useCallback(async (direction: 'left' | 'right' | 'up' | 'down') => {
    if (animationLockRef.current) return;
    if (direction === 'left' && canSwipeLeft && !canSwipeLeft()) return;
    if (direction === 'right' && canSwipeRight && !canSwipeRight()) return;

    animationLockRef.current = true;
    try {
      const horizontal = direction === 'left' || direction === 'right';
      const distance = horizontal
        ? (containerRef.current?.clientWidth ?? window.innerWidth)
        : (containerRef.current?.clientHeight ?? window.innerHeight);

      await animate(horizontal ? x : y, direction === 'left' || direction === 'up' ? -distance : distance, {
        duration: 0.2,
        ease: 'easeOut',
      });

      let navigation: void | Promise<void> = undefined;
      flushSync(() => {
        if (direction === 'left') onSwipeLeft();
        else if (direction === 'right') onSwipeRight();
        else if (direction === 'up') navigation = onNextTopic();
        else navigation = onPreviousTopic();
      });
      await navigation;
    } catch (error) {
      console.error('Unable to navigate feed card:', error);
    } finally {
      x.jump(0);
      y.jump(0);
      animationLockRef.current = false;
    }
  }, [canSwipeLeft, canSwipeRight, onNextTopic, onPreviousTopic, onSwipeLeft, onSwipeRight, x, y]);

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTopicSwipeGesture({
    enabled: active,
    motionValues: { x, y },
    canSwipeHorizontal: (direction) => direction === 'next'
      ? (!canSwipeLeft || canSwipeLeft())
      : (!canSwipeRight || canSwipeRight()),
    onSwipeHorizontal: (direction) => move(direction === 'next' ? 'left' : 'right'),
    onSwipeVertical: (direction) => move(direction === 'next' ? 'up' : 'down'),
  });

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || animationLockRef.current) return;

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          void move('right');
          break;
        case 'ArrowRight':
          event.preventDefault();
          void move('left');
          break;
        case 'ArrowUp':
          event.preventDefault();
          void move('down');
          break;
        case 'ArrowDown':
          event.preventDefault();
          void move('up');
          break;
        case ' ':
          event.preventDefault();
          void move(event.shiftKey ? 'down' : 'up');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, move]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden" aria-hidden={!active} inert={!active}>
      <motion.div
        role="region"
        aria-roledescription="feed card"
        aria-label={ariaLabel}
        tabIndex={0}
        className="relative h-full w-full transform-gpu will-change-transform select-none"
        style={{ x, y, width: '100%', height: '100%', touchAction: 'none' }}
        onPointerDown={active ? handlePointerDown : undefined}
        onPointerMove={active ? handlePointerMove : undefined}
        onPointerUp={active ? handlePointerUp : undefined}
        onPointerCancel={active ? handlePointerUp : undefined}
      >
        {previousPreview ? (
          <div className="pointer-events-none absolute inset-x-0 top-[-100%] h-full opacity-90" aria-hidden="true" inert>
            {previousPreview}
          </div>
        ) : null}
        {previousHorizontalPreview ? (
          <div className="pointer-events-none absolute top-0 left-[-100%] h-full w-full opacity-90" aria-hidden="true" inert>
            {previousHorizontalPreview}
          </div>
        ) : null}
        {children}
        {nextHorizontalPreview ? (
          <div className="pointer-events-none absolute top-0 left-[100%] h-full w-full opacity-90" aria-hidden="true" inert>
            {nextHorizontalPreview}
          </div>
        ) : null}
        {nextPreview ? (
          <div className="pointer-events-none absolute inset-x-0 top-[100%] h-full opacity-90" aria-hidden="true" inert>
            {nextPreview}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
