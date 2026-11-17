'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

import { shuffle } from '@/lib/utils';
import {
  TOP_COMMENT_CADENCE,
  getNextTopCommentCadence,
  getUnseenTopFeedComments,
  parseTopFeedComments,
  shouldInsertTopCommentCard,
  type TopFeedComment,
} from '@/lib/feed-comments';
import { TopCommentFeedCard } from './TopCommentFeedCard';
import {
  SPONSOR_CARD_CADENCE,
  getNextSponsorCadence,
  parseSponsorFeedCampaigns,
  shouldInsertSponsorCard,
  type SponsorFeedCampaign,
} from '@/lib/sponsor-campaigns';
import { SponsorFeedCard } from './SponsorFeedCard';
import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator';
import { siteConfig } from '@/lib/constants';
import { buildFeedQueue, findFeedQueueEntryIndex, getFeedQueueWindow } from '@/lib/feed-queue';

import type { TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import { Topic } from '@/types';

type FeedCursor = TopicPageCursor | RecommendationCursor;
type FeedPage = { topics: Topic[]; nextCursor: FeedCursor | null };

function createSponsorSessionId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null;
}
type ViewerProps = {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  active?: boolean;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  nextEntryPreview?: ReactNode;
};
type TopicFeedCoreProps = {
  topics: Topic[];
  nextCursor: FeedCursor | null;
  personalized: boolean;
  loadPage: (cursor: FeedCursor) => Promise<FeedPage>;
  userId: string | null;
  viewer: ComponentType<ViewerProps>;
  preservePositionOnUpdate?: boolean;
  topCommentsEndpoint?: string;
  onOpenComment: (comment: TopFeedComment) => void;
  getSponsorAccessToken?: () => Promise<string | null>;
  sponsorApiBaseUrl?: string;
};

export function TopicFeedCore({
  topics,
  nextCursor: initialCursor,
  personalized,
  loadPage,
  userId,
  viewer: Viewer,
  preservePositionOnUpdate = false,
  topCommentsEndpoint,
  onOpenComment,
  getSponsorAccessToken,
  sponsorApiBaseUrl,
}: TopicFeedCoreProps) {
  const nativeSponsorApiBaseUrl =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'capacitor-electron:' ||
      window.location.origin === 'http://localhost' ||
      window.location.origin === 'https://localhost')
      ? siteConfig.url
      : undefined;
  const effectiveSponsorApiBaseUrl = sponsorApiBaseUrl ?? nativeSponsorApiBaseUrl;
  const [feedTopics, setFeedTopics] = useState<Topic[]>(topics);
  const [topComments, setTopComments] = useState<TopFeedComment[]>([]);
  const [topCommentsNextOffset, setTopCommentsNextOffset] = useState<number | null>(null);
  const [topCommentInventoryVersion, setTopCommentInventoryVersion] = useState(0);
  const topCommentsPageLoading = useRef(false);
  const [feedSessionUserId, setFeedSessionUserId] = useState(userId);
  const [showTopCommentCard, setShowTopCommentCard] = useState(false);
  const seenTopCommentIds = useRef(new Set<number>());
  const seenTopCommentUserId = useRef(userId);
  const topCommentCadenceUserId = useRef(userId);
  const [topCommentCardsByTopicId, setTopCommentCardsByTopicId] = useState<Map<string, TopFeedComment[]>>(() => new Map());
  const [topicsSinceTopCommentCard, setTopicsSinceTopCommentCard] = useState(0);
  const topCommentCadenceAnchor = useRef<{ topicId: string; value: number } | null>(null);
  const [showSponsorCard, setShowSponsorCard] = useState(false);
  const [topicsSinceSponsorCard, setTopicsSinceSponsorCard] = useState(0);
  const sponsorCadenceAnchor = useRef<{ topicId: string; value: number } | null>(null);
  const [sponsorCardsByTopicId, setSponsorCardsByTopicId] = useState<Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string }>>(() => new Map());
  const cacheTopCommentGroup = useCallback((topicId: string, comments: TopFeedComment[]) => {
    setTopCommentCardsByTopicId((current) => {
      const next = new Map(current);
      next.set(topicId, comments);
      return next;
    });
    if (!topCommentsPageLoading.current) {
      setTopCommentInventoryVersion((version) => version + 1);
    }
  }, []);
  const clearTopCommentGroups = useCallback(() => setTopCommentCardsByTopicId(new Map()), []);
  const cacheSponsorPlacement = useCallback((
    topicId: string,
    placement: { campaigns: SponsorFeedCampaign[]; sessionId: string }
  ) => {
    setSponsorCardsByTopicId((current) => {
      const next = new Map(current);
      next.set(topicId, placement);
      return next;
    });
  }, []);
  const clearSponsorPlacements = useCallback(() => setSponsorCardsByTopicId(new Map()), []);

  const sponsorSessionUserId = useRef(userId);
  const sponsorLoadingRef = useRef(false);
  const sponsorRequestVersion = useRef(0);
  const feedMountedRef = useRef(false);
  const sponsorRequestPreviousCadence = useRef(0);
  const sponsorPrefetchRef = useRef<{
    topicId: string;
    userId: string;
    promise: Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null }>;
  } | null>(null);
  const pendingSponsorAfterComment = useRef(false);

  useEffect(() => {
    feedMountedRef.current = true;
    return () => {
      feedMountedRef.current = false;
      sponsorRequestVersion.current += 1;
      sponsorLoadingRef.current = false;
    };
  }, []);

  const [topicIndex, setTopicIndex] = useState(personalized ? 0 : Math.floor(topics.length / 2));
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);
  const generationRef = useRef(0);
  const currentTopicId = useRef<string | null>(null);

  useEffect(() => {
    currentTopicId.current = feedTopics[topicIndex]?.id ?? null;
  }, [feedTopics, topicIndex]);
  const feedQueue = buildFeedQueue(
    feedTopics,
    topCommentCardsByTopicId,
    sponsorCardsByTopicId
  );
  const activeFeedQueueType = feedSessionUserId === userId
    ? showSponsorCard
      ? 'sponsor'
      : showTopCommentCard
        ? 'top-comments'
        : 'topic'
    : 'topic';
  const activeFeedQueueIndex = findFeedQueueEntryIndex(feedQueue, topicIndex, activeFeedQueueType);
  const feedQueueWindow = getFeedQueueWindow(feedQueue, activeFeedQueueIndex);


  useEffect(() => {
    if (seenTopCommentUserId.current === userId) return;
    seenTopCommentUserId.current = userId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedSessionUserId(userId);
    topCommentCadenceUserId.current = userId;
    topCommentCadenceAnchor.current = null;
    seenTopCommentIds.current.clear();
    clearTopCommentGroups();
    setShowTopCommentCard(false);
    setTopicsSinceTopCommentCard(0);
  }, [userId, clearTopCommentGroups]);

  useEffect(() => {
    if (sponsorSessionUserId.current === userId) return;
    sponsorSessionUserId.current = userId;
    sponsorPrefetchRef.current = null;
    sponsorCadenceAnchor.current = null;
    clearSponsorPlacements();
    sponsorRequestVersion.current += 1;
    sponsorLoadingRef.current = false;
    pendingSponsorAfterComment.current = false;
    setShowSponsorCard(false);
    setTopicsSinceSponsorCard(0);
    setTopicsSinceTopCommentCard(0);
  }, [userId, clearSponsorPlacements]);

  const loadSponsorCampaigns = useCallback(
    async (topic: Topic): Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null }> => {
      if (!userId || !getSponsorAccessToken) return { campaigns: [], sessionId: null };
      // Give each sponsor-card placement its own ID for reliable event attribution.
      const sessionId = createSponsorSessionId();
      if (!sessionId) return { campaigns: [], sessionId: null };

      try {
        const accessToken = await getSponsorAccessToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const campaignsEndpoint = effectiveSponsorApiBaseUrl
          ? new URL('/api/content/sponsored-campaigns', effectiveSponsorApiBaseUrl).toString()
          : '/api/content/sponsored-campaigns';
        const response = await fetch(campaignsEndpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({
            sessionId,
            categorySlug: topic.categorySlug ?? null,
            topicId: topic.id,
          }),
        });
        if (!response.ok) return { campaigns: [], sessionId: null };
        return { campaigns: parseSponsorFeedCampaigns(await response.json()), sessionId };
      } catch {
        return { campaigns: [], sessionId: null };
      }
    },
    [effectiveSponsorApiBaseUrl, getSponsorAccessToken, userId]
  );

  useEffect(() => {
    if (feedSessionUserId !== userId || !userId || sponsorLoadingRef.current || topicsSinceSponsorCard !== SPONSOR_CARD_CADENCE - 1) return;
    const topic = feedTopics[topicIndex];
    if (!topic || sponsorCardsByTopicId.has(topic.id)) return;
    const existing = sponsorPrefetchRef.current;
    if (existing?.topicId === topic.id && existing.userId === userId) return;

    const promise = loadSponsorCampaigns(topic);
    sponsorPrefetchRef.current = { topicId: topic.id, userId, promise };
    void promise.then((result) => {
      if (
        !feedMountedRef.current ||
        sponsorPrefetchRef.current?.promise !== promise ||
        sponsorSessionUserId.current !== userId
      ) return;
      if (result.campaigns.length > 0 && result.sessionId) {
        cacheSponsorPlacement(topic.id, {
          campaigns: result.campaigns,
          sessionId: result.sessionId,
        });
          } else if (sponsorPrefetchRef.current?.promise === promise) {
        // Retry at the due boundary in case eligibility changes after prefetch.
        sponsorPrefetchRef.current = null;
      }
    });
  }, [feedTopics, topicIndex, topicsSinceSponsorCard, userId, feedSessionUserId, loadSponsorCampaigns, cacheSponsorPlacement, sponsorCardsByTopicId]);

  useEffect(() => {
    let cancelled = false;
    const refresh = createFeedRefreshCoordinator(async () => {
      try {
        const endpoint = topCommentsEndpoint ?? '/api/content/top-comments';
        const pageUrl = new URL(endpoint, window.location.origin);
        pageUrl.searchParams.set('offset', '0');
        pageUrl.searchParams.set('limit', '100');
        const response = await fetch(pageUrl.toString(), {
          cache: 'default',
          credentials: topCommentsEndpoint ? 'omit' : 'same-origin',
        });
        if (!response.ok) return false;

        const payload: unknown = await response.json();
        if (!cancelled) {
          const comments = parseTopFeedComments(payload);
          const nextOffset = typeof payload === 'object' && payload !== null && 'next_offset' in payload &&
            (payload.next_offset === null || (Number.isSafeInteger(payload.next_offset) && Number(payload.next_offset) >= 0))
            ? payload.next_offset as number | null : null;
          setTopCommentsNextOffset(nextOffset);
          setTopComments((current) => {
            if (nextOffset === null) return comments;
            const byId = new Map(current.map((comment) => [comment.comment_id, comment] as const));
            for (const comment of comments) byId.set(comment.comment_id, comment);
            return [...byId.values()];
          });

          if (comments.length === 0) {
            setShowTopCommentCard(false);
            clearTopCommentGroups();
                  }
        }
        return true;
      } catch {
        // Top comments are optional feed inventory. A failed request must not
        // interrupt topic navigation; reconnect explicitly bypasses the cooldown.
        return false;
      }
    }, 30_000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh.request();
    };
    const refreshWhenOnline = () => void refresh.reconnect();

    void refresh.request();
    window.addEventListener('online', refreshWhenOnline);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      refresh.dispose();
      window.removeEventListener('online', refreshWhenOnline);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [topCommentsEndpoint, clearTopCommentGroups]);

  useEffect(() => {
    if (feedSessionUserId !== userId || topicsSinceTopCommentCard !== TOP_COMMENT_CADENCE - 1) return;
    if (seenTopCommentUserId.current !== userId) return;
    const topic = feedTopics[topicIndex];
    if (!topic || topCommentCardsByTopicId.has(topic.id)) return;

    const unseen = getUnseenTopFeedComments(topComments, seenTopCommentIds.current);
    if (unseen.length < 5 && topCommentsNextOffset !== null) return;
    const group = unseen.slice(0, 5);
    if (group.length === 0) return;

    group.forEach((comment) => seenTopCommentIds.current.add(comment.comment_id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cacheTopCommentGroup(topic.id, group);
  }, [
    topicsSinceTopCommentCard,
    feedTopics,
    topicIndex,
    topComments,
    topCommentsNextOffset,
    topCommentCardsByTopicId,
    topCommentInventoryVersion,
    userId,
    feedSessionUserId,
    cacheTopCommentGroup,
  ]);

  useEffect(() => {
    if (topCommentsPageLoading.current || topCommentsNextOffset === null) return;
    const unseenCount = getUnseenTopFeedComments(topComments, seenTopCommentIds.current).length;
    if (unseenCount > 10) return;

    topCommentsPageLoading.current = true;
    const loadNextPage = async () => {
      try {
        const endpoint = topCommentsEndpoint ?? '/api/content/top-comments';
        const pageUrl = new URL(endpoint, window.location.origin);
        pageUrl.searchParams.set('offset', String(topCommentsNextOffset));
        pageUrl.searchParams.set('limit', '100');
        const response = await fetch(pageUrl.toString(), {
          cache: 'default',
          credentials: topCommentsEndpoint ? 'omit' : 'same-origin',
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!feedMountedRef.current || typeof payload !== 'object' || payload === null || !('comments' in payload)) return;
        const nextComments = parseTopFeedComments(payload);
        const nextOffset = 'next_offset' in payload &&
          (payload.next_offset === null || (Number.isSafeInteger(payload.next_offset) && Number(payload.next_offset) >= 0))
          ? payload.next_offset as number | null : null;
        setTopComments((current) => {
          const known = new Set(current.map((comment) => comment.comment_id));
          return [...current, ...nextComments.filter((comment) => !known.has(comment.comment_id))];
        });
        setTopCommentsNextOffset(nextOffset);
      } catch {
        // Inventory paging is best-effort; existing feed content remains usable.
      } finally {
        topCommentsPageLoading.current = false;
      }
    };
    void loadNextPage();
  }, [topComments, topCommentsNextOffset, topCommentInventoryVersion, topCommentsEndpoint]);

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    // Signed-out users get the existing shuffled feed; personalized server
    // ranking is preserved for signed-in users and starts at its top result.
    const shuffled = personalized ? topics : shuffle(topics);
    const previousIndex = preservePositionOnUpdate
      ? shuffled.findIndex((topic) => topic.id === currentTopicId.current)
      : -1;
    generationRef.current += 1;
    loadingRef.current = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedTopics(shuffled);

    setTopicIndex(
      previousIndex >= 0 ? previousIndex : personalized ? 0 : Math.floor(shuffled.length / 2)
    );
    setNextCursor(initialCursor);
    setLoadingMore(false);
    setLoadError('');
  }, [topics, initialCursor, personalized, preservePositionOnUpdate]);

  const loadMoreTopics = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    const generation = generationRef.current;
    setLoadingMore(true);
    setLoadError('');

    try {
      const result = await loadPage(nextCursor);
      if (generation !== generationRef.current) return;
      const newTopics = result.topics;
      setFeedTopics((previous) => [
        ...previous,
        ...(personalized ? newTopics : shuffle(newTopics)),
      ]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (generation !== generationRef.current) return;
      console.error('Unable to load the next topic feed page:', error);
      setLoadError(error instanceof Error ? error.message : 'Unable to load more topics.');
    } finally {
      if (generation === generationRef.current) {
        loadingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [nextCursor, personalized, loadPage]);

  // ----------------------------------
  // Navigation
  // ----------------------------------

  // Modulo arithmetic wraps the finite catalogue into a circular feed.
  const advanceToNextTopic = () => {
    if (topicIndex >= feedTopics.length - 3 && nextCursor) {
      void loadMoreTopics();
    }

    if (topicIndex >= feedTopics.length - 1 && nextCursor) {
      return;
    }

    setTopicIndex((prev) => (prev + 1) % feedTopics.length);
  };

  const activateFeedQueueEntry = (entry: NonNullable<typeof feedQueueWindow.current>) => {
    if (entry.type === 'topic') {
      setTopicIndex(entry.topicIndex);
      setShowTopCommentCard(false);
      setShowSponsorCard(false);
      return;
    }
    if (entry.type === 'top-comments') {
      setTopicsSinceTopCommentCard(0);
      setShowSponsorCard(false);
      setShowTopCommentCard(true);
      return;
    }
    setTopicsSinceSponsorCard(0);
    pendingSponsorAfterComment.current = false;
    setShowTopCommentCard(false);
    setShowSponsorCard(true);
  };

  const navigateToPreviousQueueEntry = () => {
    const previousEntry = feedQueueWindow.previous;
    if (previousEntry) {
      activateFeedQueueEntry(previousEntry);
      return;
    }
    previousTopic();
  };

  const nextTopic = () => {
    // Ignore repeated gestures while the due sponsor inventory request is in flight.
    if (sponsorLoadingRef.current) return;

    let currentCommentCadence = topicsSinceTopCommentCard;
    let currentSponsorCadence = topicsSinceSponsorCard;

    if (seenTopCommentUserId.current !== userId) {
      seenTopCommentUserId.current = userId;
      seenTopCommentIds.current.clear();
      clearTopCommentGroups();
      currentCommentCadence = 0;
    }

    if (topCommentCadenceUserId.current !== userId) {
      topCommentCadenceUserId.current = userId;
      currentCommentCadence = 0;
    }

    if (sponsorSessionUserId.current !== userId) {
      sponsorSessionUserId.current = userId;
      clearSponsorPlacements();
        currentSponsorCadence = 0;
    }

    const unseenTopComments = getUnseenTopFeedComments(
      topComments,
      seenTopCommentIds.current
    );
    const currentCommentTopic = feedTopics[topicIndex];
    const commentGroupAlreadyPrepared = Boolean(
      currentCommentTopic && topCommentCardsByTopicId.has(currentCommentTopic.id)
    );
    const commentInventoryNeedsAnotherPage =
      !commentGroupAlreadyPrepared &&
      currentCommentCadence === TOP_COMMENT_CADENCE - 1 &&
      unseenTopComments.length < 5 &&
      topCommentsNextOffset !== null;
    if (commentInventoryNeedsAnotherPage) {
      if (!topCommentsPageLoading.current) {
        setTopCommentInventoryVersion((version) => version + 1);
      }
      return;
    }
    const commentDue = shouldInsertTopCommentCard(
      currentCommentCadence,
      unseenTopComments.length > 0
    );
    const sponsorDue = shouldInsertSponsorCard(currentSponsorCadence, Boolean(userId));
    const nextCommentCadence = getNextTopCommentCadence(currentCommentCadence);
    const nextSponsorCadence = getNextSponsorCadence(currentSponsorCadence);
    const cadenceTopic = feedTopics[topicIndex];
    if (cadenceTopic && nextCommentCadence < currentCommentCadence) {
      topCommentCadenceAnchor.current = {
        topicId: cadenceTopic.id,
        value: currentCommentCadence,
      };
    }
    if (cadenceTopic && sponsorDue) {
      sponsorCadenceAnchor.current = {
        topicId: cadenceTopic.id,
        value: currentSponsorCadence,
      };
    }

    const queuedNextEntry = feedQueueWindow.current?.type === 'topic'
      ? feedQueueWindow.next
      : null;
    if (queuedNextEntry?.type === 'top-comments') {
      pendingSponsorAfterComment.current = sponsorDue;
      activateFeedQueueEntry(queuedNextEntry);
      return;
    }
    if (queuedNextEntry?.type === 'sponsor' && !commentDue) {
      if (sponsorDue) {
        setTopicsSinceTopCommentCard(nextCommentCadence);
        setTopicsSinceSponsorCard(0);
      }
      activateFeedQueueEntry(queuedNextEntry);
      return;
    }

    // Existing queue entries take priority over loading another topic page.
    if (topicIndex >= feedTopics.length - 1 && nextCursor) {
      void loadMoreTopics();
      return;
    }

    // Keep the two cadences independent. If both are due, show the comment
    // first and then the sponsor placement at the same topic boundary.
    const chooseSponsor = sponsorDue && !commentDue;

    if (chooseSponsor) {
      const currentTopic = feedTopics[topicIndex];
      setTopicsSinceTopCommentCard(commentDue ? currentCommentCadence : nextCommentCadence);
      sponsorRequestPreviousCadence.current = topicsSinceSponsorCard;
      setTopicsSinceSponsorCard(0);
      pendingSponsorAfterComment.current = false;

      if (!currentTopic || sponsorLoadingRef.current) {
        advanceToNextTopic();
        return;
      }

      sponsorLoadingRef.current = true;
      const requestedUserId = userId;
      const requestVersion = ++sponsorRequestVersion.current;
      const prefetched = sponsorPrefetchRef.current;
      const sponsorRequest = prefetched?.topicId === currentTopic.id && prefetched.userId === requestedUserId
        ? prefetched.promise
        : loadSponsorCampaigns(currentTopic);
      void sponsorRequest.then((result) => {
        if (!feedMountedRef.current || sponsorRequestVersion.current !== requestVersion ||
            sponsorSessionUserId.current !== requestedUserId) return;
        if (result.campaigns.length > 0 && result.sessionId) {
          cacheSponsorPlacement(currentTopic.id, {
            campaigns: result.campaigns,
            sessionId: result.sessionId,
          });
        setShowTopCommentCard(false);
        setShowSponsorCard(true);
          return;
        }

        if (commentDue && unseenTopComments.length > 0) {
          setTopicsSinceTopCommentCard(0);
          const nextTopCommentGroup = unseenTopComments.slice(0, 5);
          nextTopCommentGroup.forEach((comment) => seenTopCommentIds.current.add(comment.comment_id));
          cacheTopCommentGroup(currentTopic.id, nextTopCommentGroup);
                setShowSponsorCard(false);
          setShowTopCommentCard(true);
          return;
        }

        advanceToNextTopic();
      }).finally(() => {
        if (sponsorRequestVersion.current === requestVersion) {
          sponsorLoadingRef.current = false;
        }
      });
      return;
    }

    setTopicsSinceSponsorCard(sponsorDue ? currentSponsorCadence : nextSponsorCadence);

    if (commentDue) {
      pendingSponsorAfterComment.current = sponsorDue;
      setTopicsSinceTopCommentCard(0);
      const currentTopic = feedTopics[topicIndex];
      if (currentTopic) {
        const nextTopCommentGroup = unseenTopComments.slice(0, 5);
        nextTopCommentGroup.forEach((comment) => seenTopCommentIds.current.add(comment.comment_id));
        cacheTopCommentGroup(currentTopic.id, nextTopCommentGroup);
            setShowSponsorCard(false);
        setShowTopCommentCard(true);
        return;
      }
    }

    setTopicsSinceTopCommentCard(nextCommentCadence);
    advanceToNextTopic();
  };

  const markTopCommentViewed = useCallback(
    (commentId: number) => {
      if (seenTopCommentUserId.current !== userId) {
        seenTopCommentUserId.current = userId;
        seenTopCommentIds.current.clear();
        clearTopCommentGroups();
      }
      seenTopCommentIds.current.add(commentId);
      setTopCommentInventoryVersion((version) => version + 1);
    },
    [userId, clearTopCommentGroups]
  );

  const openTopComment = (comment: TopFeedComment) => {
    onOpenComment(comment);
  };

  const previousTopic = () => {
    if (sponsorLoadingRef.current) {
      sponsorRequestVersion.current += 1;
      sponsorLoadingRef.current = false;
      setTopicsSinceSponsorCard(sponsorRequestPreviousCadence.current);
    }
    pendingSponsorAfterComment.current = false;
    if (seenTopCommentUserId.current !== userId) {
      seenTopCommentUserId.current = userId;
      seenTopCommentIds.current.clear();
      clearTopCommentGroups();
    }

    const previousQueueEntry = feedQueueWindow.previous;
    if (previousQueueEntry && previousQueueEntry.type !== 'topic') {
      activateFeedQueueEntry(previousQueueEntry);
      return;
    }

    const previousIndex = (topicIndex - 1 + feedTopics.length) % feedTopics.length;
    const previousTopicId = feedTopics[previousIndex]?.id;
    const previousSponsorCard = previousTopicId
      ? sponsorCardsByTopicId.get(previousTopicId)
      : undefined;
    if (previousSponsorCard?.campaigns.length) {
        setShowTopCommentCard(false);
      setShowSponsorCard(true);
      return;
    }

    const previousCard = previousTopicId
      ? topCommentCardsByTopicId.get(previousTopicId)
      : undefined;

    if (previousCard?.length) {
        setShowTopCommentCard(true);
      return;
    }

    const currentTopicId = feedTopics[topicIndex]?.id;
    if (topCommentCadenceAnchor.current?.topicId === currentTopicId) {
      setTopicsSinceTopCommentCard(
        (topCommentCadenceAnchor.current.value + TOP_COMMENT_CADENCE - 1) % TOP_COMMENT_CADENCE
      );
    } else if (topCommentCadenceAnchor.current?.topicId === previousTopicId) {
      setTopicsSinceTopCommentCard(topCommentCadenceAnchor.current.value);
    } else {
      setTopicsSinceTopCommentCard((current) => Math.max(0, current - 1));
    }

    if (sponsorCadenceAnchor.current?.topicId === currentTopicId) {
      setTopicsSinceSponsorCard(
        (sponsorCadenceAnchor.current.value + SPONSOR_CARD_CADENCE - 1) % SPONSOR_CARD_CADENCE
      );
    } else if (sponsorCadenceAnchor.current?.topicId === previousTopicId) {
      setTopicsSinceSponsorCard(sponsorCadenceAnchor.current.value);
    } else {
      setTopicsSinceSponsorCard((current) => Math.max(0, current - 1));
    }
    setTopicIndex(previousIndex);
  };

  const noop = () => {};

  const handleSponsorNext = (topicId: string) => {
    setShowSponsorCard(false);
    if (sponsorPrefetchRef.current?.topicId === topicId) {
      sponsorPrefetchRef.current = null;
    }
    if (sponsorCadenceAnchor.current?.topicId === topicId) {
      sponsorCadenceAnchor.current = null;
    }
    advanceToNextTopic();
  };

  const handleTopCommentNext = (): boolean => {
    if (sponsorLoadingRef.current) return false;
    const currentTopic = feedTopics[topicIndex];
    if (feedQueueWindow.next?.type === 'sponsor') {
      pendingSponsorAfterComment.current = false;
      activateFeedQueueEntry(feedQueueWindow.next);
      return true;
    }
    if (!pendingSponsorAfterComment.current) {
      setShowTopCommentCard(false);
      advanceToNextTopic();
      return true;
    }

    pendingSponsorAfterComment.current = false;
    if (!currentTopic) {
      setShowTopCommentCard(false);
      setTopicsSinceSponsorCard(0);
      advanceToNextTopic();
      return true;
    }

    sponsorLoadingRef.current = true;
    sponsorRequestPreviousCadence.current = topicsSinceSponsorCard;
    const requestedUserId = userId;
    const requestVersion = ++sponsorRequestVersion.current;
    const prefetched = sponsorPrefetchRef.current;
    const sponsorRequest = prefetched?.topicId === currentTopic.id && prefetched.userId === requestedUserId
      ? prefetched.promise
      : loadSponsorCampaigns(currentTopic);
    void sponsorRequest.then((result) => {
      if (
        !feedMountedRef.current ||
        sponsorRequestVersion.current !== requestVersion ||
        sponsorSessionUserId.current !== requestedUserId
      ) return;
      setTopicsSinceSponsorCard(0);
      if (result.campaigns.length > 0 && result.sessionId) {
        cacheSponsorPlacement(currentTopic.id, {
          campaigns: result.campaigns,
          sessionId: result.sessionId,
        });
        setShowTopCommentCard(false);
        setShowSponsorCard(true);
        return;
      }

      setShowTopCommentCard(false);
      advanceToNextTopic();
    }).finally(() => {
      if (sponsorRequestVersion.current === requestVersion) {
        sponsorLoadingRef.current = false;
      }
    });
    return true;
  };

  const renderFeedQueueEntry = (
    entry: NonNullable<typeof feedQueueWindow.current>,
    active: boolean
  ) => {
    if (entry.type === 'topic') {
      return (
        <Viewer
          topics={feedTopics}
          topicIndex={entry.topicIndex}
          initialUserId={userId}
          active={active}
          onNextTopic={nextTopic}
          onPreviousTopic={previousTopic}
          nextEntryPreview={
            active && feedQueueWindow.next && feedQueueWindow.next.type !== 'topic'
              ? renderFeedQueueEntry(feedQueueWindow.next, false)
              : undefined
          }
        />
      );
    }

    if (entry.type === 'top-comments') {
      return (
        <TopCommentFeedCard
          comments={entry.comments}
          userId={userId}
          previewMode={!active}
          active={active}
          onCommentViewed={active ? markTopCommentViewed : noop}
          onNextTopic={handleTopCommentNext}
          onPreviousTopic={navigateToPreviousQueueEntry}
          onOpenComment={active ? openTopComment : noop}
          nextEntryPreview={
            active && feedQueueWindow.next && feedQueueWindow.next.type !== 'topic'
              ? renderFeedQueueEntry(feedQueueWindow.next, false)
              : undefined
          }
        />
      );
    }

    return (
      <SponsorFeedCard
        campaigns={entry.campaigns}
        sessionId={entry.sessionId}
        userId={userId ?? ''}
        previewMode={!active}
        sponsorApiBaseUrl={effectiveSponsorApiBaseUrl}
        getAccessToken={getSponsorAccessToken ?? (async () => null)}
        onNextTopic={() => handleSponsorNext(entry.topicId)}
        onPreviousTopic={navigateToPreviousQueueEntry}
        nextEntryPreview={
          active && feedQueueWindow.next && feedQueueWindow.next.type !== 'topic'
            ? renderFeedQueueEntry(feedQueueWindow.next, false)
            : undefined
        }
      />
    );
  };

  // ----------------------------------
  // Loading
  // ----------------------------------

  if (!feedTopics.length) {
    return null;
  }

  return (
    <div className="h-full" >
      {(loadingMore || loadError) && (
        <div className="bg-bg-primary/90 absolute top-20 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow">
          {loadError ? (
            <button type="button" onClick={() => void loadMoreTopics()} className="text-accent">
              {loadError} Retry
            </button>
          ) : (
            <span className="text-text-secondary">Loading more topics…</span>
          )}
        </div>
      )}
      <div className="relative h-full">
        {[feedQueueWindow.previous, feedQueueWindow.current, feedQueueWindow.next]
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .map((entry) => {
            const active = entry.id === feedQueueWindow.current?.id;
            return (
              <div
                key={entry.id}
                className={active ? 'absolute inset-0 h-full w-full' : 'hidden'}
                aria-hidden={!active}
                data-feed-queue-entry={entry.type}
              >
                {renderFeedQueueEntry(entry, active)}
              </div>
            );
          })}
      </div>
    </div>
  );
}
