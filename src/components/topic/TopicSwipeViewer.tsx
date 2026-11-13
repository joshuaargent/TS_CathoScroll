'use client';

import { animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Heart } from 'lucide-react';
import type { Topic } from '@/types';
import type { TopicActivity } from '@/lib/topic-activity';
import { getTopicSlides } from '@/lib/topicSlides';
import { TopicCard } from './TopicCard';
import { TopicProgress } from './TopicProgress';

interface TopicSwipeViewerProps {
  topics: Topic[];
  topicIndex: number;
  active?: boolean;
  userId: string | null;
  currentActivity:
    | (Omit<TopicActivity, 'likes' | 'comments'> & {
        likes: number | null;
        comments: number | null;
      })
    | null;
  currentActivityError: boolean;
  actionError: string;
  pendingActions: Set<string>;
  retryActivity: () => void;
  onLike: () => void;
  onDoubleTapLike: () => void;
  onBookmark: () => void;
  onComments: () => void;
  onShare: () => void;
  onComplete: (topicId: string) => void;
  onNextTopic?: () => void;
  onPreviousTopic?: () => void;
}

export function TopicSwipeViewer({
  topics,
  topicIndex,
  active = true,
  userId,
  currentActivity,
  currentActivityError,
  actionError,
  pendingActions,
  retryActivity,
  onLike,
  onDoubleTapLike,
  onBookmark,
  onComments,
  onShare,
  onComplete,
  onNextTopic,
  onPreviousTopic,
}: TopicSwipeViewerProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [axis, setAxis] = useState<'x' | 'y' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const startRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const currentTopic = topics[topicIndex];
  const currentTopicId = String(currentTopic.id);
  const previousTopic = topics[(topicIndex - 1 + topics.length) % topics.length];
  const nextTopic = topics[(topicIndex + 1) % topics.length];
  const slides = useMemo(() => getTopicSlides(currentTopic), [currentTopic]);
  const currentSlide = slides[slideIndex];
  const previousSlide = slideIndex > 0 ? slides[slideIndex - 1] : null;
  const nextSlide = slideIndex < slides.length - 1 ? slides[slideIndex + 1] : null;
  const interactionVisible = !isAnimating;

  const likeTopic = () => {
    if (
      isAnimating ||
      !userId ||
      !currentActivity ||
      currentActivity.liked ||
      pendingActions.has(`like:${currentTopicId}`)
    ) {
      if (!userId && !isAnimating) onDoubleTapLike();
      return;
    }
    setShowHeart(true);
    window.setTimeout(() => setShowHeart(false), 1000);
    onDoubleTapLike();
  };

  const springHome = () => {
    animate(x, 0, {
      type: 'spring',
      stiffness: 1800,
      damping: 120,
    });

    animate(y, 0, {
      type: 'spring',
      stiffness: 1800,
      damping: 120,
    });
  };

  const moveSlide = async (direction: 'next' | 'previous') => {
    if (isAnimating) return;

    setIsAnimating(true);

    try {
      // Horizontal movement changes a section of the current topic. Completing
      // its Scripture slide records topic progress before the viewer resets.
      const width = containerRef.current?.clientWidth ?? window.innerWidth;

      await animate(x, direction === 'next' ? -width : width, {
        duration: 0.2,
        ease: 'easeOut',
      });

      let nextIndex = slideIndex;

      flushSync(() => {
        nextIndex = direction === 'next' ? slideIndex + 1 : slideIndex - 1;

        setSlideIndex(nextIndex);
      });

      if (slides[nextIndex]?.type === 'scripture') {
        onComplete(currentTopicId);
      }

      x.jump(0);
    } finally {
      setIsAnimating(false);
    }
  };

  const moveTopic = async (direction: 'next' | 'previous') => {
    if (isAnimating) return;

    setIsAnimating(true);

    try {
      // Vertical movement changes the topic and always starts the new topic
      // on its first slide.
      const height = containerRef.current?.clientHeight ?? window.innerHeight;

      await animate(y, direction === 'next' ? -height : height, {
        duration: 0.2,
        ease: 'easeOut',
      });

      flushSync(() => {
        setSlideIndex(0);

        if (direction === 'next') {
          onNextTopic?.();
        } else {
          onPreviousTopic?.();
        }
      });

      y.jump(0);
    } finally {
      setIsAnimating(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = async (event: globalThis.KeyboardEvent) => {
      if (!active) return;
      if (event.repeat) return;
      if (isAnimating) return;

      const target = event.target as HTMLElement;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();

          if (previousSlide) {
            await moveSlide('previous');
          }
          break;

        case 'ArrowRight':
          event.preventDefault();

          if (nextSlide) {
            await moveSlide('next');
          }
          break;

        case 'ArrowUp':
          event.preventDefault();

          if (previousTopic) {
            await moveTopic('previous');
          }
          break;

        case 'ArrowDown':
          event.preventDefault();
          await moveTopic('next');
          break;

        case ' ':
          event.preventDefault();

          if (event.shiftKey) {
            if (previousTopic) {
              await moveTopic('previous');
            }
          } else {
            await moveTopic('next');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    previousSlide,
    nextSlide,
    previousTopic,
    nextTopic,
    isAnimating,
    currentActivity,
    userId,
    onNextTopic,
    onPreviousTopic,
  ]);

  const handlePointerDown = (event: React.PointerEvent) => {
    setIsDragging(true);

    event.currentTarget.setPointerCapture(event.pointerId);

    setAxis(null);

    currentRef.current = {
      x: 0,
      y: 0,
    };

    startRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!isDragging) return;

    const deltaX = event.clientX - startRef.current.x;

    const deltaY = event.clientY - startRef.current.y;

    if (!axis) {
      // Lock the gesture to whichever direction moved farther once the
      // pointer has moved enough to distinguish a swipe from a tap.
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        setAxis(Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y');
      }

      return;
    }

    if (axis === 'x') {
      x.set(deltaX);

      y.set(0);

      currentRef.current.x = deltaX;
    }

    if (axis === 'y') {
      y.set(deltaY);

      x.set(0);

      currentRef.current.y = deltaY;
    }
  };

  const handlePointerUp = async () => {
    setIsDragging(false);

    const dx = currentRef.current.x;

    const dy = currentRef.current.y;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const wasTap = absDx < 10 && absDy < 10;

    const velocityX = absDx / 16;

    const velocityY = absDy / 16;

    const width = window.innerWidth;

    const height = window.innerHeight;

    // AQA-style pseudocode:
    // IF gesture axis is horizontal THEN
    //   commit ← distance > 7% of width OR estimated velocity > 25
    //   IF committed and moved left/right with a slide available THEN move slide
    //   ELSE return the card to its starting position
    // ELSE IF gesture axis is vertical THEN
    //   apply the same rule using height and move between topics
    // IF both distances are under 10 pixels AND taps are under 300 ms apart
    //   LIKE current topic
    if (axis === 'x') {
      const threshold = width * 0.07;

      const commit = absDx > threshold || velocityX > 25;

      if (commit && dx < 0 && nextSlide) {
        await moveSlide('next');
      } else if (commit && dx > 0 && previousSlide) {
        await moveSlide('previous');
      } else {
        springHome();
      }
    }

    if (axis === 'y') {
      const threshold = height * 0.07;

      const commit = absDy > threshold || velocityY > 25;

      if (commit && dy < 0) {
        await moveTopic('next');
      } else if (commit && dy > 0) {
        await moveTopic('previous');
      } else {
        springHome();
      }
    }

    if (wasTap) {
      // Two taps within 300 ms like the current topic; a single tap does not.
      const now = Date.now();

      if (now - lastTapRef.current < 300) {
        void likeTopic();
      }

      lastTapRef.current = now;
    }

    currentRef.current = {
      x: 0,
      y: 0,
    };

    setAxis(null);
  };

  return (
    <div className="flex h-full flex-col">
      {(currentActivityError || actionError) && (
        <div role="alert" className="bg-bg-primary px-6 py-2 text-sm text-red-600">
          {currentActivityError && (
            <>
              Unable to load topic activity.{' '}
              <button type="button" className="underline" onClick={retryActivity}>
                Retry
              </button>
            </>
          )}
          {actionError && <p>{actionError}</p>}
        </div>
      )}
      <div className="px-6 pt-4 pb-4">
        <TopicProgress current={slideIndex} total={slides.length} />
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-hidden pt-1">
        <motion.div
          style={{
            x,
            y,
            width: '100%',
            height: '100%',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute inset-0 transform-gpu will-change-transform select-none"
        >
          {/* TOP */}

          {
            <div className="absolute inset-x-0 top-[-100%] h-full opacity-90">
              <TopicCard type="question" title="Question" content={previousTopic.question} />
            </div>
          }

          {/* LEFT */}

          {previousSlide && (
            <div className="absolute top-0 left-[-100%] h-full w-full opacity-90">
              <TopicCard
                type={previousSlide.type}
                title={previousSlide.title}
                content={previousSlide.content}
                reference={previousSlide.reference}
              />
            </div>
          )}

          {/* CENTER */}

          <div className="absolute inset-0">
            {showHeart && (
              <motion.div
                initial={{
                  scale: 0.6,
                  opacity: 0,
                }}
                animate={{
                  scale: [0.6, 1.2, 1],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 0.8,
                }}
                className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
              >
                <div className="bg-accent/10 rounded-full p-8">
                  <Heart className="text-accent h-40 w-40 fill-current drop-shadow-lg" />
                </div>
              </motion.div>
            )}

            <TopicCard
              type={currentSlide.type}
              title={currentSlide.title}
              content={currentSlide.content}
              reference={currentSlide.reference}
              isLiked={interactionVisible && Boolean(currentActivity?.liked)}
              likes={interactionVisible ? (currentActivity?.likes ?? null) : null}
              comments={currentActivity?.comments ?? null}
              onComments={onComments}
              onLike={onLike}
              isBookmarked={interactionVisible && Boolean(currentActivity?.bookmarked)}
              onBookmark={onBookmark}
              onShare={onShare}
              interactionsDisabled={
                (Boolean(userId) && !currentActivity) ||
                pendingActions.has(`like:${currentTopicId}`) ||
                pendingActions.has(`bookmark:${currentTopicId}`)
              }
            />
          </div>

          {/* RIGHT */}

          {nextSlide && (
            <div className="absolute top-0 left-[100%] h-full w-full opacity-90">
              <TopicCard
                type={nextSlide.type}
                title={nextSlide.title}
                content={nextSlide.content}
                reference={nextSlide.reference}
              />
            </div>
          )}

          {/* BOTTOM */}

          {
            <div className="absolute inset-x-0 top-[100%] h-full opacity-90">
              <TopicCard type="question" title="Question" content={nextTopic.question} />
            </div>
          }
        </motion.div>
      </div>
    </div>
  );
}
