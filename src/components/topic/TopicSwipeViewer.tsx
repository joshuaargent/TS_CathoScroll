'use client';

import { animate, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Heart } from 'lucide-react';
import type { Topic } from '@/types';
import type { TopicActivity } from '@/lib/topic-activity';
import { getTopicSlides } from '@/lib/topicSlides';
import {
  installFeedAnalyticsListeners,
  recordFeedAnalyticsEvent,
  recordFeedTopicCompletion,
  recordFeedTopicVisit,
} from '@/lib/feed-analytics-client';
import { TopicCard } from './TopicCard';
import { useTopicSwipeGesture } from './useTopicSwipeGesture';

interface TopicSwipeViewerProps {
  topics: Topic[];
  topicIndex: number;
  active?: boolean;
  userId: string | null;
  analyticsEndpoint?: string;
  getAnalyticsAccessToken?: () => Promise<string | null>;
  currentActivity:
    | (Omit<TopicActivity, 'likes' | 'comments'> & {
        likes: number | null;
        comments: number | null;
      })
    | null;
  currentActivityError: boolean;
  displayCounts?: { likes: number | null; comments: number | null } | null;
  actionError: string;
  pendingActions: Set<string>;
  retryActivity: () => void;
  onLike: () => void;
  onDoubleTapLike: () => void;
  onBookmark: () => void;
  onComments: () => void;
  onShare: () => void;
  onComplete: (topicId: string) => void;
  onNextTopic?: () => void | Promise<void>;
  onPreviousTopic?: () => void | Promise<void>;
  nextEntryPreview?: ReactNode;
  previousEntryPreview?: ReactNode;
  onProgressChange?: (current: number, total: number) => void;
}

export function TopicSwipeViewer({
  topics,
  topicIndex,
  active = true,
  userId,
  analyticsEndpoint,
  getAnalyticsAccessToken,
  currentActivity,
  currentActivityError,
  displayCounts,
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
  nextEntryPreview,
  previousEntryPreview,
  onProgressChange,
}: TopicSwipeViewerProps) {
  const [slideIndex, setSlideIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationLockRef = useRef(false);
  const [showHeart, setShowHeart] = useState(false);
  const currentTopic = topics[topicIndex];
  const currentTopicId = String(currentTopic.id);
  const previousTopic = topics[(topicIndex - 1 + topics.length) % topics.length];
  const nextTopic = topics[(topicIndex + 1) % topics.length];
  const slides = useMemo(() => getTopicSlides(currentTopic), [currentTopic]);
  const currentSlide = slides[slideIndex];

  useLayoutEffect(() => {
    if (active) onProgressChange?.(slideIndex, slides.length);
  }, [active, currentTopicId, onProgressChange, slideIndex, slides.length]);

  const previousSlide = slideIndex > 0 ? slides[slideIndex - 1] : null;
  const nextSlide = slideIndex < slides.length - 1 ? slides[slideIndex + 1] : null;
  const interactionVisible = !isAnimating;
  const topicActiveSinceRef = useRef<number | null>(null);
  const topicActiveDurationRef = useRef(0);
  const topicViewableRef = useRef(false);

  useEffect(() => {
    if (!userId || !active) return;
    return installFeedAnalyticsListeners(userId, {
      endpoint: analyticsEndpoint,
      getAccessToken: getAnalyticsAccessToken,
    });
  }, [active, analyticsEndpoint, getAnalyticsAccessToken, userId]);

  useEffect(() => {
    if (!userId || !active) return;

    recordFeedTopicVisit(userId, currentTopicId);

    topicActiveDurationRef.current = 0;
    topicViewableRef.current = false;
    topicActiveSinceRef.current = null;
    let isIntersecting = false;
    let viewabilityTimer: number | null = null;

    const scheduleViewability = () => {
      if (viewabilityTimer !== null || topicViewableRef.current || !isIntersecting) return;
      viewabilityTimer = window.setTimeout(() => {
        viewabilityTimer = null;
        if (!isIntersecting || document.visibilityState !== 'visible') return;
        topicViewableRef.current = true;
        topicActiveSinceRef.current = performance.now() - 1000;
        recordFeedAnalyticsEvent(userId, 'viewable_impression', currentTopicId, {
          source: 'feed',
        });
        startActiveDuration();
      }, 1000);
    };

    const flushActiveDuration = () => {
      const startedAt = topicActiveSinceRef.current;
      if (startedAt === null) return;
      const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
      topicActiveDurationRef.current += elapsed;
      topicActiveSinceRef.current = null;

      let remaining = elapsed;
      while (remaining > 0) {
        const duration = Math.min(remaining, 60000);
        recordFeedAnalyticsEvent(userId, 'active_duration', currentTopicId, {
          duration_ms: duration,
        });
        remaining -= duration;
      }
    };

    const startActiveDuration = () => {
      if (document.visibilityState === 'visible' && topicActiveSinceRef.current === null) {
        topicActiveSinceRef.current = performance.now();
      }
    };

    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          isIntersecting = entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5
          );
          if (isIntersecting) {
            if (topicViewableRef.current) {
              startActiveDuration();
            } else {
              scheduleViewability();
            }
          } else {
            if (viewabilityTimer !== null) {
              window.clearTimeout(viewabilityTimer);
              viewabilityTimer = null;
            }
            flushActiveDuration();
          }
        }, { threshold: [0, 0.5, 1] })
      : null;

    const observedElement = containerRef.current;
    if (observedElement && observer) observer.observe(observedElement);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (viewabilityTimer !== null) {
          window.clearTimeout(viewabilityTimer);
          viewabilityTimer = null;
        }
        flushActiveDuration();
      } else if (isIntersecting) {
        if (topicViewableRef.current) {
          startActiveDuration();
        } else {
          scheduleViewability();
        }
      }
    };

    const interval = window.setInterval(flushActiveDuration, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      flushActiveDuration();
      window.clearInterval(interval);
      if (viewabilityTimer !== null) window.clearTimeout(viewabilityTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer?.disconnect();
    };
  }, [currentTopicId, userId, active]);

  useEffect(() => {
    if (!userId || slideIndex <= 0) return;
    recordFeedAnalyticsEvent(userId, 'swipe_depth', currentTopicId, {
      slide_index: slideIndex,
      depth: slideIndex,
    });

    if (slideIndex === slides.length - 1) {
      recordFeedTopicCompletion(userId, currentTopicId, slideIndex);
    }
  }, [currentTopicId, userId, slideIndex, slides.length]);

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
    if (animationLockRef.current) return;
    animationLockRef.current = true;
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
      animationLockRef.current = false;
      setIsAnimating(false);
    }
  };

  const moveTopic = async (direction: 'next' | 'previous') => {
    if (animationLockRef.current) return;

    if (direction === 'next' && userId) {
      const activeElapsed = topicActiveSinceRef.current === null
        ? 0
        : Math.max(0, performance.now() - topicActiveSinceRef.current);
      if (topicActiveDurationRef.current + activeElapsed < 2000) {
        recordFeedAnalyticsEvent(userId, 'skip', currentTopicId, {
          slide_index: slideIndex,
        });
      }
    }

    animationLockRef.current = true;
    setIsAnimating(true);

    try {
      // Vertical movement changes the topic and always starts the new topic
      // on its first slide.
      const height = containerRef.current?.clientHeight ?? window.innerHeight;

      await animate(y, direction === 'next' ? -height : height, {
        duration: 0.2,
        ease: 'easeOut',
      });

      let navigation: void | Promise<void> = undefined;
      flushSync(() => {
        setSlideIndex(0);
        navigation = direction === 'next' ? onNextTopic?.() : onPreviousTopic?.();
      });

      await navigation;
    } catch (error) {
      console.error('Unable to navigate topic feed:', error);
    } finally {
      y.jump(0);
      animationLockRef.current = false;
      setIsAnimating(false);
    }
  };


  const {
    x,
    y,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTopicSwipeGesture({
    enabled: active && !isAnimating,
    canSwipeHorizontal: (direction) => direction === 'next' ? Boolean(nextSlide) : Boolean(previousSlide),
    onSwipeHorizontal: moveSlide,
    onSwipeVertical: moveTopic,
    onDoubleTap: likeTopic,
  });

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

          {previousEntryPreview !== null ? (
            <div className="pointer-events-none absolute inset-x-0 top-[-100%] h-full opacity-90" aria-hidden="true" inert>
              {previousEntryPreview === undefined ? (
                <TopicCard type="question" title="Question" content={previousTopic.question} />
              ) : previousEntryPreview}
            </div>
          ) : null}

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
              likes={currentActivity?.likes ?? displayCounts?.likes ?? null}
              comments={currentActivity?.comments ?? displayCounts?.comments ?? null}
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

          {nextEntryPreview !== null ? (
            <div className="pointer-events-none absolute inset-x-0 top-[100%] h-full opacity-90" aria-hidden="true" inert>
              {nextEntryPreview === undefined ? (
                <TopicCard type="question" title="Question" content={nextTopic.question} />
              ) : nextEntryPreview}
            </div>
          ) : null}
        </motion.div>
      </div>
    </div>
  );
}
