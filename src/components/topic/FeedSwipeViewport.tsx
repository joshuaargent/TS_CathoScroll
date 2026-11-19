'use client';

import { animate, motion, useMotionValue } from 'framer-motion';
import { flushSync } from 'react-dom';
import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTopicSwipeGesture, type TopicSwipeDirection } from './useTopicSwipeGesture';

interface FeedSwipeViewportProps {
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  topPreview?: ReactNode;
  bottomPreview?: ReactNode;
  leftPreview?: ReactNode;
  rightPreview?: ReactNode;
  active?: boolean;
  ariaLabel?: string;
  role?: 'region' | 'group';
  tabIndex?: number;
  containerClassName?: string;
  motionClassName?: string;
  canSwipeHorizontal?: (direction: TopicSwipeDirection) => boolean;
  onSwipeHorizontal?: (direction: TopicSwipeDirection) => void | Promise<void>;
  onSwipeVertical: (direction: TopicSwipeDirection) => void | Promise<void>;
  onDoubleTap?: () => void;
  onTransitionStart?: () => void;
  onTransitionEnd?: () => void;
}

/**
 * The single feed-card viewport and transition engine.
 *
 * TopicSwipeViewer supplies its original five-position topic/slide composition;
 * comments and sponsors supply their own card content in the same five slots.
 * The viewport owns pointer/keyboard gestures, the 200ms ease-out transition,
 * navigation commit and motion-value reset for every feed entry type.
 */
export function FeedSwipeViewport({
  children,
  containerRef: externalContainerRef,
  topPreview,
  bottomPreview,
  leftPreview,
  rightPreview,
  active = true,
  ariaLabel,
  role,
  tabIndex,
  containerClassName = 'relative h-full w-full overflow-hidden',
  motionClassName = 'absolute inset-0 transform-gpu will-change-transform select-none',
  canSwipeHorizontal,
  onSwipeHorizontal,
  onSwipeVertical,
  onDoubleTap,
  onTransitionStart,
  onTransitionEnd,
}: FeedSwipeViewportProps) {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;
  const animationLockRef = useRef(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const move = useCallback(async (
    axis: 'horizontal' | 'vertical',
    direction: TopicSwipeDirection
  ) => {
    if (!active || animationLockRef.current) return;
    if (axis === 'horizontal' && canSwipeHorizontal && !canSwipeHorizontal(direction)) return;

    animationLockRef.current = true;
    setIsTransitioning(true);
    onTransitionStart?.();

    try {
      const distance = axis === 'horizontal'
        ? (containerRef.current?.clientWidth ?? window.innerWidth)
        : (containerRef.current?.clientHeight ?? window.innerHeight);
      const value = axis === 'horizontal' ? x : y;
      await animate(value, direction === 'next' ? -distance : distance, {
        duration: 0.2,
        ease: 'easeOut',
      });

      let navigation: void | Promise<void> = undefined;
      flushSync(() => {
        navigation = axis === 'horizontal'
          ? onSwipeHorizontal?.(direction)
          : onSwipeVertical(direction);
      });
      await navigation;
    } catch (error) {
      console.error('Unable to navigate feed card:', error);
    } finally {
      x.jump(0);
      y.jump(0);
      animationLockRef.current = false;
      setIsTransitioning(false);
      onTransitionEnd?.();
    }
  }, [
    active,
    canSwipeHorizontal,
    onSwipeHorizontal,
    onSwipeVertical,
    onTransitionEnd,
    onTransitionStart,
    x,
    y,
  ]);

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTopicSwipeGesture({
    enabled: active && !isTransitioning,
    motionValues: { x, y },
    isLocked: () => animationLockRef.current,
    canSwipeHorizontal,
    onSwipeHorizontal: (direction) => move('horizontal', direction),
    onSwipeVertical: (direction) => move('vertical', direction),
    onDoubleTap,
  });

  return (
    <div ref={containerRef} className={containerClassName} aria-hidden={!active} inert={!active}>
      <motion.div
        role={role}
        aria-roledescription={role ? 'feed card' : undefined}
        aria-label={ariaLabel}
        tabIndex={tabIndex}
        className={motionClassName}
        style={{ x, y, width: '100%', height: '100%', touchAction: 'none' }}
        onPointerDown={active ? handlePointerDown : undefined}
        onPointerMove={active ? handlePointerMove : undefined}
        onPointerUp={active ? handlePointerUp : undefined}
        onPointerCancel={active ? handlePointerUp : undefined}
      >
        {topPreview ? (
          <div className="pointer-events-none absolute inset-x-0 top-[-100%] h-full opacity-90" aria-hidden="true" inert>
            {topPreview}
          </div>
        ) : null}
        {leftPreview ? (
          <div className="pointer-events-none absolute top-0 left-[-100%] h-full w-full opacity-90" aria-hidden="true" inert>
            {leftPreview}
          </div>
        ) : null}
        {children}
        {rightPreview ? (
          <div className="pointer-events-none absolute top-0 left-[100%] h-full w-full opacity-90" aria-hidden="true" inert>
            {rightPreview}
          </div>
        ) : null}
        {bottomPreview ? (
          <div className="pointer-events-none absolute inset-x-0 top-[100%] h-full opacity-90" aria-hidden="true" inert>
            {bottomPreview}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
