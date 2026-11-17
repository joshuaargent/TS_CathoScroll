'use client';

import { animate, motion, useMotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

interface FeedInterstitialMotionProps {
  children: ReactNode;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  canSwipeLeft?: () => boolean;
  canSwipeRight?: () => boolean;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  ariaLabel: string;
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
}: FeedInterstitialMotionProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const start = useRef({ x: 0, y: 0 });
  const delta = useRef({ x: 0, y: 0 });
  const axis = useRef<'x' | 'y' | null>(null);
  const locked = useRef(false);
  const [dragging, setDragging] = useState(false);

  const springHome = useCallback(() => {
    void animate(x, 0, { type: 'spring', stiffness: 1800, damping: 120 });
    void animate(y, 0, { type: 'spring', stiffness: 1800, damping: 120 });
  }, [x, y]);

  const move = useCallback(async (direction: 'left' | 'right' | 'up' | 'down') => {
    if (locked.current) return;
    if (direction === 'left' && canSwipeLeft && !canSwipeLeft()) {
      springHome();
      return;
    }
    if (direction === 'right' && canSwipeRight && !canSwipeRight()) {
      springHome();
      return;
    }
    locked.current = true;
    try {
      const horizontal = direction === 'left' || direction === 'right';
      const distance = horizontal
        ? (document.documentElement.clientWidth || window.innerWidth)
        : (document.documentElement.clientHeight || window.innerHeight);
      const value = direction === 'left' || direction === 'up' ? -distance : distance;
      await animate(horizontal ? x : y, value, { duration: 0.2, ease: 'easeOut' });
      if (direction === 'left') onSwipeLeft();
      else if (direction === 'right') onSwipeRight();
      else if (direction === 'up') onNextTopic();
      else onPreviousTopic();
      x.jump(0);
      y.jump(0);
    } finally {
      locked.current = false;
    }
  }, [canSwipeLeft, canSwipeRight, onNextTopic, onPreviousTopic, onSwipeLeft, onSwipeRight, springHome, x, y]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked.current || (event.target as HTMLElement).closest('button, a, input, textarea, [contenteditable="true"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    delta.current = { x: 0, y: 0 };
    axis.current = null;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      return;
    }
    delta.current = axis.current === 'x' ? { x: dx, y: 0 } : { x: 0, y: dy };
    x.set(delta.current.x);
    y.set(delta.current.y);
  };

  const handlePointerUp = async () => {
    if (!dragging) return;
    setDragging(false);
    const { x: dx, y: dy } = delta.current;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = document.documentElement.clientHeight || window.innerHeight;
    if (axis.current === 'x') {
      if (absX > width * 0.07 || absX / 16 > 25) {
        await move(dx < 0 ? 'left' : 'right');
      } else springHome();
    } else if (axis.current === 'y') {
      if (absY > height * 0.07 || absY / 16 > 25) {
        await move(dy < 0 ? 'up' : 'down');
      } else springHome();
    } else {
      springHome();
    }
    axis.current = null;
    delta.current = { x: 0, y: 0 };
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || locked.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void move('right');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void move('left');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        void move('down');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        void move('up');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [move]);

  return (
    <motion.div
      role="region"
      aria-roledescription="feed card"
      aria-label={ariaLabel}
      tabIndex={0}
      className="h-full w-full transform-gpu will-change-transform select-none"
      style={{ x, y, touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDragging(false);
        axis.current = null;
        delta.current = { x: 0, y: 0 };
        springHome();
      }}
    >
      {children}
    </motion.div>
  );
}
