'use client';

import { animate, motion, useMotionValue } from 'framer-motion';
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

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
}: FeedInterstitialMotionProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const startRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef<'x' | 'y' | null>(null);
  const animationLockRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const springHome = useCallback(() => {
    animate(x, 0, { type: 'spring', stiffness: 1800, damping: 120 });
    animate(y, 0, { type: 'spring', stiffness: 1800, damping: 120 });
  }, [x, y]);

  const move = useCallback(async (direction: 'left' | 'right' | 'up' | 'down') => {
    if (animationLockRef.current) return;

    if (direction === 'left' && canSwipeLeft && !canSwipeLeft()) {
      springHome();
      return;
    }
    if (direction === 'right' && canSwipeRight && !canSwipeRight()) {
      springHome();
      return;
    }

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
  }, [canSwipeLeft, canSwipeRight, onNextTopic, onPreviousTopic, onSwipeLeft, onSwipeRight, springHome, x, y]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (animationLockRef.current) return;

    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    axisRef.current = null;
    currentRef.current = { x: 0, y: 0 };
    startRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const deltaX = event.clientX - startRef.current.x;
    const deltaY = event.clientY - startRef.current.y;

    if (!axisRef.current) {
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        const nextAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
        axisRef.current = nextAxis;
      }
      return;
    }

    if (axisRef.current === 'x') {
      x.set(deltaX);
      y.set(0);
      currentRef.current.x = deltaX;
      currentRef.current.y = 0;
    } else {
      y.set(deltaY);
      x.set(0);
      currentRef.current.x = 0;
      currentRef.current.y = deltaY;
    }
  };

  const handlePointerUp = async () => {
    if (!isDragging) return;

    setIsDragging(false);

    const dx = currentRef.current.x;
    const dy = currentRef.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const velocityX = absDx / 16;
    const velocityY = absDy / 16;
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (axisRef.current === 'x') {
      const commit = absDx > width * 0.07 || velocityX > 25;

      if (commit && dx < 0 && (!canSwipeLeft || canSwipeLeft())) {
        await move('left');
      } else if (commit && dx > 0 && (!canSwipeRight || canSwipeRight())) {
        await move('right');
      } else {
        springHome();
      }
    } else if (axisRef.current === 'y') {
      const commit = absDy > height * 0.07 || velocityY > 25;

      if (commit && dy < 0) {
        await move('up');
      } else if (commit && dy > 0) {
        await move('down');
      } else {
        springHome();
      }
    } else {
      springHome();
    }

    currentRef.current = { x: 0, y: 0 };
    axisRef.current = null;
  };

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
    <div ref={containerRef} className="h-full w-full overflow-hidden">
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
          <div className="pointer-events-none absolute inset-x-0 top-[-100%] h-full opacity-90">
            {previousPreview}
          </div>
        ) : null}
        {children}
        {nextPreview ? (
          <div className="pointer-events-none absolute inset-x-0 top-[100%] h-full opacity-90">
            {nextPreview}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
