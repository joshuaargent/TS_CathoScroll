'use client';

import { animate, useMotionValue, type MotionValue } from 'framer-motion';
import { useCallback, useRef, useState, type PointerEvent } from 'react';

export type TopicSwipeDirection = 'next' | 'previous';

interface UseTopicSwipeGestureOptions {
  enabled?: boolean;
  canSwipeHorizontal?: (direction: TopicSwipeDirection) => boolean;
  onSwipeHorizontal?: (direction: TopicSwipeDirection) => void | Promise<void>;
  onSwipeVertical: (direction: TopicSwipeDirection) => void | Promise<void>;
  onDoubleTap?: () => void;
}

interface TopicSwipeGesture {
  x: MotionValue<number>;
  y: MotionValue<number>;
  isDragging: boolean;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => Promise<void>;
}

/**
 * Shared gesture lifecycle for every card in the topic feed.
 *
 * The thresholds, axis locking, spring return, velocity estimate and
 * double-tap timing are taken from the original TopicSwipeViewer. Card
 * renderers supply only the action performed after a committed swipe.
 */
export function useTopicSwipeGesture({
  enabled = true,
  canSwipeHorizontal,
  onSwipeHorizontal,
  onSwipeVertical,
  onDoubleTap,
}: UseTopicSwipeGestureOptions): TopicSwipeGesture {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const startRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef<'x' | 'y' | null>(null);
  const lastTapRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const springHome = useCallback(() => {
    animate(x, 0, { type: 'spring', stiffness: 1800, damping: 120 });
    animate(y, 0, { type: 'spring', stiffness: 1800, damping: 120 });
  }, [x, y]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    axisRef.current = null;
    currentRef.current = { x: 0, y: 0 };
    startRef.current = { x: event.clientX, y: event.clientY };
  }, [enabled]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !isDragging) return;

    const deltaX = event.clientX - startRef.current.x;
    const deltaY = event.clientY - startRef.current.y;

    if (!axisRef.current) {
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        axisRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      }
      return;
    }

    if (axisRef.current === 'x') {
      x.set(deltaX);
      y.set(0);
      currentRef.current = { x: deltaX, y: 0 };
    } else {
      y.set(deltaY);
      x.set(0);
      currentRef.current = { x: 0, y: deltaY };
    }
  }, [enabled, isDragging, x, y]);

  const handlePointerUp = useCallback(async () => {
    if (!isDragging) return;
    setIsDragging(false);

    const dx = currentRef.current.x;
    const dy = currentRef.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const wasTap = absDx < 10 && absDy < 10;
    const velocityX = absDx / 16;
    const velocityY = absDy / 16;

    try {
      if (axisRef.current === 'x') {
        const commit = absDx > window.innerWidth * 0.07 || velocityX > 25;
        if (commit && dx < 0 && (!canSwipeHorizontal || canSwipeHorizontal('next'))) {
          await onSwipeHorizontal?.('next');
        } else if (commit && dx > 0 && (!canSwipeHorizontal || canSwipeHorizontal('previous'))) {
          await onSwipeHorizontal?.('previous');
        } else {
          springHome();
        }
      } else if (axisRef.current === 'y') {
        const commit = absDy > window.innerHeight * 0.07 || velocityY > 25;
        if (commit && dy < 0) {
          await onSwipeVertical('next');
        } else if (commit && dy > 0) {
          await onSwipeVertical('previous');
        } else {
          springHome();
        }
      } else {
        springHome();
      }

      if (wasTap && onDoubleTap) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) onDoubleTap();
        lastTapRef.current = now;
      }
    } finally {
      currentRef.current = { x: 0, y: 0 };
      axisRef.current = null;
    }
  }, [
    canSwipeHorizontal,
    isDragging,
    onDoubleTap,
    onSwipeHorizontal,
    onSwipeVertical,
    springHome,
  ]);

  return { x, y, isDragging, handlePointerDown, handlePointerMove, handlePointerUp };
}
