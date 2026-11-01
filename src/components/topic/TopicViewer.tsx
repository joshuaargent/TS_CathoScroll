'use client';

import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

import { animate, motion, useMotionValue } from 'framer-motion';

import { useEffect, useMemo, useRef, useState } from 'react';

import { flushSync } from 'react-dom';

import { Heart } from 'lucide-react';

import { Topic } from '@/types';
import { getTopicSlides } from '@/lib/topicSlides';

import { TopicCard } from './TopicCard';
import { TopicProgress } from './TopicProgress';

interface TopicViewerProps {
  topics: Topic[];
  topicIndex: number;

  onNextTopic?: () => void;
  onPreviousTopic?: () => void;
}

export function TopicViewer({
  topics,
  topicIndex,
  onNextTopic,
  onPreviousTopic,
}: TopicViewerProps) {
  const router = useRouter();

  const [slideIndex, setSlideIndex] = useState(0);

  const [axis, setAxis] = useState<'x' | 'y' | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const startRef = useRef({
    x: 0,
    y: 0,
  });

  const currentRef = useRef({
    x: 0,
    y: 0,
  });

  const lastTapRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);

  const currentTopic = topics[topicIndex];

  const currentTopicId = String(currentTopic.id);

  const previousTopic = topics[(topicIndex - 1 + topics.length) % topics.length];

  const nextTopic = topics[(topicIndex + 1) % topics.length];

  const slides = useMemo(() => getTopicSlides(currentTopic), [currentTopic]);

  const [isAnimating, setIsAnimating] = useState(false);

  const [likedTopics, setLikedTopics] = useState(() => new Set<string>());

  const [showHeart, setShowHeart] = useState(false);

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});

  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  const [bookmarks, setBookmarks] = useState(() => new Set<string>());

  const [completedTopics, setCompletedTopics] = useState(() => new Set<string>());

  const [userId, setUserId] = useState<string | null>(null);

  const currentSlide = slides[slideIndex];

  const isBookmarked = bookmarks.has(currentTopicId);

  const bookmarksLoaded = useRef(false);

  const interactionVisible = !isAnimating;

  useEffect(() => {
    if (bookmarksLoaded.current) {
      return;
    }

    bookmarksLoaded.current = true;

    async function loadUserData() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLikedTopics(new Set());
        setBookmarks(new Set());
        setCompletedTopics(new Set());
        return;
      }

      const [bookmarksResult, progressResult, likesResult] = await Promise.all([
        supabase.from('bookmarks').select('topic_id').eq('user_id', user.id),

        supabase.from('progress').select('topic_id').eq('user_id', user.id),

        supabase.from('topic_likes').select('topic_id').eq('user_id', user.id),
      ]);

      setLikedTopics(new Set(likesResult.data?.map((like) => String(like.topic_id)) ?? []));

      setBookmarks(
        new Set(bookmarksResult.data?.map((bookmark) => String(bookmark.topic_id)) ?? [])
      );

      setCompletedTopics(
        new Set(progressResult.data?.map((progress) => String(progress.topic_id)) ?? [])
      );

      setUserId(user.id);
    }

    loadUserData();
  }, []);

  useEffect(() => {
    async function loadLikeCounts() {
      const supabase = createClient();

      const { data } = await supabase.from('topic_likes').select('topic_id');

      const counts: Record<string, number> = {};

      data?.forEach((like) => {
        const id = String(like.topic_id);

        counts[id] = (counts[id] ?? 0) + 1;
      });

      setLikeCounts(counts);
    }

    loadLikeCounts();
  }, []);

  useEffect(() => {
    async function loadCommentCounts() {
      const supabase = createClient();

      const { data } = await supabase
        .from('comments')
        .select('topic_id,is_deleted')
        .eq('is_deleted', false);

      const counts: Record<string, number> = {};

      data?.forEach((comment) => {
        const id = String(comment.topic_id);

        counts[id] = (counts[id] ?? 0) + 1;
      });

      setCommentCounts(counts);
    }

    loadCommentCounts();
  }, []);

  const previousSlide = slideIndex > 0 ? slides[slideIndex - 1] : null;

  const nextSlide = slideIndex < slides.length - 1 ? slides[slideIndex + 1] : null;

  const likeTopic = async () => {
    if (isAnimating) {
      return;
    }

    if (likedTopics.has(currentTopicId)) {
      return;
    }

    setShowHeart(true);

    window.setTimeout(() => {
      setShowHeart(false);
    }, 1000);

    await toggleLike();
  };

  const toggleLike = async () => {
    const supabase = createClient();

    if (!userId) {
      router.push('/signin');

      return;
    }

    const currentlyLiked = likedTopics.has(currentTopicId);

    if (currentlyLiked) {
      setLikedTopics((prev) => {
        const next = new Set(prev);

        next.delete(currentTopicId);

        return next;
      });

      setLikeCounts((prev) => ({
        ...prev,
        [currentTopicId]: Math.max(0, (prev[currentTopicId] ?? 1) - 1),
      }));

      await supabase
        .from('topic_likes')
        .delete()
        .eq('user_id', userId)
        .eq('topic_id', currentTopicId);

      return;
    }

    setLikedTopics((prev) => {
      const next = new Set(prev);

      next.add(currentTopicId);

      return next;
    });

    setLikeCounts((prev) => ({
      ...prev,
      [currentTopicId]: (prev[currentTopicId] ?? 0) + 1,
    }));

    const { error } = await supabase.from('topic_likes').insert({
      user_id: userId,
      topic_id: currentTopicId,
    });

    if (error) {
      setLikedTopics((prev) => {
        const next = new Set(prev);

        next.delete(currentTopicId);

        return next;
      });

      setLikeCounts((prev) => ({
        ...prev,
        [currentTopicId]: Math.max(0, (prev[currentTopicId] ?? 1) - 1),
      }));
    }
  };

  const toggleBookmark = async () => {
    const supabase = createClient();

    if (!userId) {
      router.push('/signin');
      return;
    }

    const currentlyBookmarked = bookmarks.has(currentTopicId);

    if (currentlyBookmarked) {
      setBookmarks((prev) => {
        const next = new Set(prev);

        next.delete(currentTopicId);

        return next;
      });

      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('topic_id', currentTopicId);

      if (error) {
        setBookmarks((prev) => {
          const next = new Set(prev);

          next.add(currentTopicId);

          return next;
        });
      }

      return;
    }

    setBookmarks((prev) => {
      const next = new Set(prev);

      next.add(currentTopicId);

      return next;
    });

    const { error } = await supabase.from('bookmarks').insert({
      user_id: userId,
      topic_id: currentTopicId,
    });

    if (error) {
      setBookmarks((prev) => {
        const next = new Set(prev);

        next.delete(currentTopicId);

        return next;
      });
    }
  };

  const openComments = () => {
    router.push(`/topic/${currentTopic.slug}#comments`);
  };

  const shareTopic = async () => {
    try {
      const url =
        typeof window !== 'undefined' ? `${window.location.origin}/topic/${currentTopic.slug}` : '';

      if (navigator.share) {
        await navigator.share({
          title: currentTopic.question,
          url,
        });

        return;
      }

      await navigator.clipboard.writeText(url);
    } catch {}
  };

  const markCompleted = async (topicId: string) => {
    if (!userId) {
      return;
    }

    if (completedTopics.has(topicId)) {
      return;
    }

    setCompletedTopics((prev) => {
      const next = new Set(prev);

      next.add(topicId);

      return next;
    });

    const supabase = createClient();

    const { error } = await supabase.from('progress').upsert(
      {
        user_id: userId,
        topic_id: topicId,
      },
      {
        onConflict: 'user_id,topic_id',
      }
    );

    if (error) {
      setCompletedTopics((prev) => {
        const next = new Set(prev);

        next.delete(topicId);

        return next;
      });
    }
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
        void markCompleted(currentTopicId);
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
  }, [previousSlide, nextSlide, previousTopic, nextTopic, isAnimating]);

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
              isLiked={interactionVisible && likedTopics.has(currentTopicId)}

              likes={interactionVisible ? (likeCounts[currentTopicId] ?? 0) : 0}

              comments={commentCounts[currentTopicId] ?? 0}
              onComments={openComments}

              onLike={toggleLike}
              isBookmarked={interactionVisible && isBookmarked}
              onBookmark={toggleBookmark}
              onShare={shareTopic}
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
