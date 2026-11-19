'use client';

import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { recordAnonymousFeedEvent } from '@/lib/anonymous-feed-analytics-client';
import { FeedSwipeViewport } from './FeedSwipeViewport';

function getActiveElapsed(startedAt: number | null) {
  return startedAt === null ? 0 : Math.max(0, performance.now() - startedAt);
}

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
    if (userId || !active) return;
    recordAnonymousFeedEvent('topic', currentTopicId, 'impression');
    let intersecting = false;
    let viewable = false;
    let viewTimer: number | null = null;
    let durationTimer: number | null = null;
    let activeSince = 0;
    let totalActive = 0;
    const flushDuration = () => {
      if (!activeSince) return;
      const elapsed = Math.max(0, Math.round(performance.now() - activeSince));
      activeSince = 0;
      totalActive += elapsed;
      if (elapsed > 0) recordAnonymousFeedEvent('topic', currentTopicId, 'active_duration', elapsed);
    };
    const startDuration = () => {
      if (!viewable || document.visibilityState !== 'visible' || activeSince) return;
      activeSince = performance.now();
      if (durationTimer === null) durationTimer = window.setInterval(flushDuration, 30000);
    };
    const scheduleView = () => {
      if (!intersecting || viewable || viewTimer !== null || document.visibilityState !== 'visible') return;
      viewTimer = window.setTimeout(() => {
        viewTimer = null;
        if (!intersecting || document.visibilityState !== 'visible') return;
        viewable = true;
        recordAnonymousFeedEvent('topic', currentTopicId, 'viewable_impression');
        startDuration();
      }, 1000);
    };
    const observer = typeof IntersectionObserver !== 'undefined' && containerRef.current
      ? new IntersectionObserver((entries) => {
          intersecting = Boolean(entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.5);
          if (intersecting) scheduleView();
          else { if (viewTimer !== null) window.clearTimeout(viewTimer); viewTimer = null; flushDuration(); }
        }, { threshold: [0, 0.5, 1] })
      : null;
    if (containerRef.current && observer) observer.observe(containerRef.current);
    else { intersecting = true; scheduleView(); }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { if (viewTimer !== null) window.clearTimeout(viewTimer); viewTimer = null; flushDuration(); }
      else if (intersecting) { if (viewable) startDuration(); else scheduleView(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flushDuration();
      if (durationTimer !== null) window.clearInterval(durationTimer);
      if (viewTimer !== null) window.clearTimeout(viewTimer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, currentTopicId, userId]);

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
    if (!userId && slideIndex === slides.length - 1) recordAnonymousFeedEvent('topic', currentTopicId, 'completion');
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

  const moveSlide = async (direction: 'next' | 'previous') => {
    const nextIndex = direction === 'next' ? slideIndex + 1 : slideIndex - 1;
    setSlideIndex(nextIndex);

    if (slides[nextIndex]?.type === 'scripture') {
      onComplete(currentTopicId);
    }
  };

  const moveTopic = (direction: 'next' | 'previous') => {
    if (direction === 'next' && !userId && topicActiveDurationRef.current + getActiveElapsed(topicActiveSinceRef.current) < 2000) {
      recordAnonymousFeedEvent('topic', currentTopicId, 'skip');
    }
    if (direction === 'next' && userId) {
      const activeElapsed = getActiveElapsed(topicActiveSinceRef.current);
      if (topicActiveDurationRef.current + activeElapsed < 2000) {
        recordFeedAnalyticsEvent(userId, 'skip', currentTopicId, {
          slide_index: slideIndex,
        });
      }
    }

    setSlideIndex(0);
    return direction === 'next' ? onNextTopic?.() : onPreviousTopic?.();
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
      <FeedSwipeViewport
        active={active}
        containerRef={containerRef}
        containerClassName="relative flex-1 overflow-hidden pt-1"
        motionClassName="absolute inset-0 transform-gpu will-change-transform select-none"
        canSwipeHorizontal={(direction) => direction === 'next' ? Boolean(nextSlide) : Boolean(previousSlide)}
        onSwipeHorizontal={moveSlide}
        onSwipeVertical={moveTopic}
        awaitVerticalNavigation={false}
        onDoubleTap={likeTopic}
        onTransitionStart={() => setIsAnimating(true)}
        onTransitionEnd={() => setIsAnimating(false)}
        topPreview={
          previousEntryPreview !== null
            ? previousEntryPreview === undefined
              ? <TopicCard type="question" title="Question" content={previousTopic.question} />
              : previousEntryPreview
            : null
        }
        leftPreview={previousSlide ? (
          <TopicCard
            type={previousSlide.type}
            title={previousSlide.title}
            content={previousSlide.content}
            reference={previousSlide.reference}
          />
        ) : null}
        rightPreview={nextSlide ? (
          <TopicCard
            type={nextSlide.type}
            title={nextSlide.title}
            content={nextSlide.content}
            reference={nextSlide.reference}
          />
        ) : null}
        bottomPreview={
          nextEntryPreview !== null
            ? nextEntryPreview === undefined
              ? <TopicCard type="question" title="Question" content={nextTopic.question} />
              : nextEntryPreview
            : null
        }
      >
        <div className="absolute inset-0">
          {showHeart && (
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [0.6, 1.2, 1], opacity: [0, 1, 0] }}
              transition={{ duration: 0.8 }}
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
      </FeedSwipeViewport>
    </div>
  );
}
