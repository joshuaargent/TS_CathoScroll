'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';

import { shuffle } from '@/lib/utils';
import {
  getNextTopCommentCadence,
  getTopCommentGroup,
  getUnseenTopFeedComments,
  parseTopFeedComments,
  shouldInsertTopCommentCard,
  type TopFeedComment,
} from '@/lib/feed-comments';
import { TopCommentFeedCard } from './TopCommentFeedCard';
import {
  getNextSponsorCadence,
  parseSponsorFeedCampaigns,
  shouldInsertSponsorCard,
  type SponsorFeedCampaign,
} from '@/lib/sponsor-campaigns';
import { SponsorFeedCard } from './SponsorFeedCard';
import { SponsorLoadingCard } from './SponsorLoadingCard';
import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator';
import { siteConfig } from '@/lib/constants';

import type { TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import { Topic } from '@/types';

type FeedCursor = TopicPageCursor | RecommendationCursor;
type FeedPage = { topics: Topic[]; nextCursor: FeedCursor | null };

function appendUniqueFeedTopics(existing: Topic[], incoming: Topic[]): Topic[] {
  const knownIds = new Set(existing.map((topic) => topic.id));
  const additions = incoming.filter((topic) => {
    if (knownIds.has(topic.id)) return false;
    knownIds.add(topic.id);
    return true;
  });
  return additions.length > 0 ? [...existing, ...additions] : existing;
}

function createSponsorSessionId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null;
}
type ViewerProps = {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  onNextTopic: () => void | Promise<void>;
  onPreviousTopic: () => void | Promise<void>;
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
  const feedTopicsRef = useRef(feedTopics);
  const feedInitializedRef = useRef(false);
  const previousPersonalizedRef = useRef(personalized);
  const [topComments, setTopComments] = useState<TopFeedComment[]>([]);
  const topCommentsRef = useRef<TopFeedComment[]>([]);
  const topCommentsNextOffsetRef = useRef<number | null>(null);
  const topCommentsLoadingRef = useRef(false);
  const [topCommentCardComments, setTopCommentCardComments] = useState<TopFeedComment[]>([]);
  const [showTopCommentCard, setShowTopCommentCard] = useState(false);
  const seenTopCommentIds = useRef(new Set<number>());
  const seenTopCommentUserId = useRef(userId);
  const topCommentCadenceUserId = useRef(userId);
  const topCommentCardsByTopicId = useRef(new Map<string, TopFeedComment[]>());
  const topCommentIndexByTopicId = useRef(new Map<string, number>());
  const processedTopicBoundariesByTopicId = useRef(new Set<string>());
  const [topicsSinceTopCommentCard, setTopicsSinceTopCommentCard] = useState(0);
  const [sponsorCampaigns, setSponsorCampaigns] = useState<SponsorFeedCampaign[]>([]);
  const [showSponsorCard, setShowSponsorCard] = useState(false);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [topicsSinceSponsorCard, setTopicsSinceSponsorCard] = useState(0);
  const sponsorCardsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string }>());
  const sponsorResultsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string | null }>());
  const sponsorRequestsByTopicId = useRef(new Map<string, Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }>>());
  const [activeSponsorSessionId, setActiveSponsorSessionId] = useState<string | null>(null);
  const sponsorSessionUserId = useRef(userId);
  const sponsorLoadingRef = useRef(false);
  const sponsorRequestVersion = useRef(0);
  const sponsorRequestPreviousCadence = useRef(0);
  const pendingSponsorAfterComment = useRef(false);
  const sponsorDueByTopicId = useRef(new Set<string>());
  const sponsorPreviousIsComment = useRef(false);
  const topCommentIsPreviousEntry = useRef(false);
  const sponsorIsPreviousEntry = useRef(false);
  const [activeTopCommentIndex, setActiveTopCommentIndex] = useState(0);
  const activeInterstitialTopicIdRef = useRef<string | null>(null);
  const activateInterstitialTopic = (topicId: string | null) => {
    activeInterstitialTopicIdRef.current = topicId;
    setActiveTopCommentIndex(
      topicId ? topCommentIndexByTopicId.current.get(topicId) ?? 0 : 0
    );
  };

  const [topicIndex, setTopicIndex] = useState(personalized ? 0 : Math.floor(topics.length / 2));
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);
  const pendingAdvanceAfterPageRef = useRef(false);
  const generationRef = useRef(0);
  const currentTopicId = useRef<string | null>(null);

  useEffect(() => {
    currentTopicId.current = feedTopics[topicIndex]?.id ?? null;
    feedTopicsRef.current = feedTopics;
  }, [feedTopics, topicIndex]);

  useEffect(() => {
    if (sponsorSessionUserId.current === userId) return;
    sponsorSessionUserId.current = userId;
    sponsorPreviousIsComment.current = false;
    activeInterstitialTopicIdRef.current = null;
    setActiveSponsorSessionId(null);
    sponsorCardsByTopicId.current.clear();
    sponsorResultsByTopicId.current.clear();
    sponsorRequestsByTopicId.current.clear();
    sponsorDueByTopicId.current.clear();
    sponsorRequestVersion.current += 1;
    sponsorLoadingRef.current = false;
    pendingSponsorAfterComment.current = false;
    setSponsorCampaigns([]);
    setShowSponsorCard(false);
    setSponsorLoading(false);
    setTopicsSinceSponsorCard(0);
    setTopicsSinceTopCommentCard(0);
  }, [userId]);

  const loadSponsorCampaigns = useCallback(
    async (topic: Topic): Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }> => {
      if (!userId || !getSponsorAccessToken) return { campaigns: [], sessionId: null, retryable: true };
      // Give each sponsor-card placement its own ID for reliable event attribution.
      const sessionId = createSponsorSessionId();
      if (!sessionId) return { campaigns: [], sessionId: null, retryable: true };

      try {
        const accessToken = await getSponsorAccessToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (!accessToken) return { campaigns: [], sessionId: null, retryable: true };
        headers.Authorization = `Bearer ${accessToken}`;
        const campaignsEndpoint = effectiveSponsorApiBaseUrl
          ? new URL('/api/content/sponsored-campaigns', effectiveSponsorApiBaseUrl).toString()
          : '/api/content/sponsored-campaigns';
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(campaignsEndpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              sessionId,
              categorySlug: topic.categorySlug ?? null,
              topicId: topic.id,
            }),
          });
          if (!response.ok) {
            console.warn('Sponsor campaign request was not successful:', response.status);
            return { campaigns: [], sessionId: null, retryable: true };
          }
          return { campaigns: parseSponsorFeedCampaigns(await response.json()), sessionId };
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch {
        console.warn('Sponsor campaign request failed; the placement can be retried.');
        return { campaigns: [], sessionId: null, retryable: true };
      }
    },
    [effectiveSponsorApiBaseUrl, getSponsorAccessToken, userId]
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = createFeedRefreshCoordinator(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        let payload: unknown;
        try {
          const response = await fetch(topCommentsEndpoint ?? '/api/content/top-comments', {
            cache: 'default',
            credentials: topCommentsEndpoint ? 'omit' : 'same-origin',
            signal: controller.signal,
          });
          if (!response.ok) return false;
          payload = await response.json();
        } finally {
          window.clearTimeout(timeoutId);
        }
        if (!cancelled) {
          const comments = parseTopFeedComments(payload);
          const nextOffset =
            typeof payload === 'object' && payload !== null && 'next_offset' in payload &&
            (payload.next_offset === null ||
              (Number.isSafeInteger(payload.next_offset) && Number(payload.next_offset) >= 0))
              ? payload.next_offset as number | null
              : null;
          // Refresh the first ranked page without discarding already loaded
          // later pages from this session. Duplicate IDs are merged once.
          const firstPageIds = new Set(comments.map((comment) => comment.comment_id));
          const mergedComments = [
            ...comments,
            ...topCommentsRef.current.filter((comment) => !firstPageIds.has(comment.comment_id)),
          ];
          topCommentsRef.current = mergedComments;
          topCommentsNextOffsetRef.current = nextOffset;
          const commentsById = new Map(
            mergedComments.map((comment) => [comment.comment_id, comment] as const)
          );
          const reconcileComments = (items: TopFeedComment[]) =>
            items.flatMap((item) => {
              const currentComment = commentsById.get(item.comment_id);
              return currentComment ? [currentComment] : [];
            });

          setTopComments(mergedComments);
          setTopCommentCardComments((current) => reconcileComments(current));

          for (const [topicId, cardComments] of topCommentCardsByTopicId.current) {
            const remainingComments = reconcileComments(cardComments);
            if (remainingComments.length > 0) {
              topCommentCardsByTopicId.current.set(topicId, remainingComments);
            } else {
              topCommentCardsByTopicId.current.delete(topicId);
              topCommentIndexByTopicId.current.delete(topicId);
            }
          }

          if (comments.length === 0) {
            topCommentsRef.current = [];
            topCommentsNextOffsetRef.current = null;
            setTopComments([]);
            setShowTopCommentCard(false);
            setTopCommentCardComments([]);
            topCommentCardsByTopicId.current.clear();
            topCommentIndexByTopicId.current.clear();
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
  }, [topCommentsEndpoint]);

  const getSponsorCampaignResult = useCallback(
    (topic: Topic): Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }> => {
      const cached = sponsorResultsByTopicId.current.get(topic.id);
      if (cached) return Promise.resolve(cached);

      const inFlight = sponsorRequestsByTopicId.current.get(topic.id);
      if (inFlight) return inFlight;

      const requestedUserId = userId;
      const request = loadSponsorCampaigns(topic)
        .then((result) => {
          // Cache both successful and empty results. A missing placement is a
          // stable decision for this topic during the current feed session.
          if (sponsorSessionUserId.current === requestedUserId && !result.retryable) {
            // Cache a successful placement or a successful empty eligibility
            // result. Never pin a transient auth/network/server failure as the
            // permanent no-campaign decision for this topic in this session.
            sponsorResultsByTopicId.current.set(topic.id, result);
            if (result.campaigns.length > 0 && result.sessionId) {
              sponsorCardsByTopicId.current.set(topic.id, {
                campaigns: result.campaigns,
                sessionId: result.sessionId,
              });
            } else {
              sponsorDueByTopicId.current.delete(topic.id);
            }
          }
          return result;
        })
        .finally(() => {
          // An older request can finish after a retry has already replaced it.
          // Only the promise currently registered for this topic may clear it.
          if (sponsorRequestsByTopicId.current.get(topic.id) === request) {
            sponsorRequestsByTopicId.current.delete(topic.id);
          }
        });

      sponsorRequestsByTopicId.current.set(topic.id, request);
      return request;
    },
    [loadSponsorCampaigns, userId]
  );

  const loadMoreTopComments = useCallback(async () => {
    const offset = topCommentsNextOffsetRef.current;
    if (offset === null || topCommentsLoadingRef.current) return;
    topCommentsLoadingRef.current = true;

    try {
      const endpoint = topCommentsEndpoint ?? '/api/content/top-comments';
      const separator = endpoint.includes('?') ? '&' : '?';
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);
      let payload: unknown;
      try {
        const response = await fetch(`${endpoint}${separator}offset=${offset}&limit=100`, {
          cache: 'default',
          credentials: topCommentsEndpoint ? 'omit' : 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) return;
        payload = await response.json();
      } finally {
        window.clearTimeout(timeoutId);
      }
      const comments = parseTopFeedComments(payload);
      const nextOffset =
        typeof payload === 'object' && payload !== null && 'next_offset' in payload &&
        (payload.next_offset === null ||
          (Number.isSafeInteger(payload.next_offset) && Number(payload.next_offset) > offset))
          ? payload.next_offset as number | null
          : null;

      const knownIds = new Set(topCommentsRef.current.map((comment) => comment.comment_id));
      const additions = comments.filter((comment) => {
        if (knownIds.has(comment.comment_id)) return false;
        knownIds.add(comment.comment_id);
        return true;
      });
      const mergedComments = additions.length > 0
        ? [...topCommentsRef.current, ...additions]
        : topCommentsRef.current;
      topCommentsRef.current = mergedComments;
      topCommentsNextOffsetRef.current = nextOffset;
      if (additions.length > 0) setTopComments(mergedComments);
    } catch {
      // Additional comment inventory is optional and can be retried later.
    } finally {
      topCommentsLoadingRef.current = false;
    }
  }, [topCommentsEndpoint]);

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    // Signed-out users get the existing shuffled feed. Signed-in users keep
    // the server's analytics-ranked recommendation order and cursor.
    const shuffled = personalized ? topics : shuffle(topics);
    const sourceChanged = previousPersonalizedRef.current !== personalized;

    if (preservePositionOnUpdate && feedInitializedRef.current) {
      // Native catalogue/background updates must not replace the active
      // session snapshot or discard pages already visited. Append only new IDs.
      const nextFeedTopics = appendUniqueFeedTopics(feedTopicsRef.current, shuffled);
      const preservedIndex = nextFeedTopics.findIndex(
        (topic) => topic.id === currentTopicId.current
      );

        setFeedTopics(nextFeedTopics);
      feedTopicsRef.current = nextFeedTopics;
      if (preservedIndex >= 0) {
        setTopicIndex(preservedIndex);
      } else {
        setTopicIndex((current) => Math.min(current, Math.max(0, nextFeedTopics.length - 1)));
      }

      if (sourceChanged) {
        // Recommendation-to-catalogue fallback changes the pagination source,
        // but not the already displayed session history.
        generationRef.current += 1;
        loadingRef.current = false;
        setNextCursor(initialCursor);
        setLoadingMore(false);
        setLoadError('');
      }
      previousPersonalizedRef.current = personalized;
      return;
    }

    generationRef.current += 1;
    loadingRef.current = false;
    setFeedTopics(shuffled);
    feedTopicsRef.current = shuffled;
    setTopicIndex(personalized ? 0 : Math.floor(shuffled.length / 2));
    setNextCursor(initialCursor);
    setLoadingMore(false);
    setLoadError('');
    feedInitializedRef.current = true;
    previousPersonalizedRef.current = personalized;
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
      const newTopics = personalized ? result.topics : shuffle(result.topics);
      const previousLength = feedTopicsRef.current.length;
      const nextTopics = appendUniqueFeedTopics(feedTopicsRef.current, newTopics);
      feedTopicsRef.current = nextTopics;
      setFeedTopics(nextTopics);
      setNextCursor(result.nextCursor);

      // If the user reached the final loaded topic while pagination was in
      // flight, continue onto the first newly appended topic exactly once.
      // A reverse gesture clears this intent before the request completes.
      if (pendingAdvanceAfterPageRef.current) {
        pendingAdvanceAfterPageRef.current = false;
        if (nextTopics.length > previousLength) {
          setTopicIndex(previousLength);
        } else if (!result.nextCursor) {
          setTopicIndex(0);
        } else {
          setLoadError('No new topics were returned. Retry loading the feed.');
        }
      }
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
      pendingAdvanceAfterPageRef.current = true;
      void loadMoreTopics();
      return;
    }

    pendingAdvanceAfterPageRef.current = false;
    activateInterstitialTopic(null);
    topCommentIsPreviousEntry.current = false;
    sponsorIsPreviousEntry.current = false;
    sponsorPreviousIsComment.current = false;
    setTopicIndex((prev) => (prev + 1) % feedTopics.length);
  };

  const nextTopic = async () => {
    // Ignore repeated gestures while the due sponsor inventory request is in flight.
    if (sponsorLoadingRef.current) return;

    // Re-entering a topic replays the exact interstitials already assigned to
    // it. This keeps the user's feed mapping stable across reverse/forward
    // navigation and across loops through the loaded recommendation sequence.
    const currentTopic = feedTopics[topicIndex];
    if (currentTopic) {
      const cachedComments = topCommentCardsByTopicId.current.get(currentTopic.id);
      const cachedSponsor = sponsorCardsByTopicId.current.get(currentTopic.id);
      if (cachedComments?.length) {
        activateInterstitialTopic(currentTopic.id);
        sponsorPreviousIsComment.current = false;
        topCommentIsPreviousEntry.current = false;
        setTopCommentCardComments(cachedComments);
        pendingSponsorAfterComment.current = Boolean(cachedSponsor?.campaigns.length) ||
          sponsorDueByTopicId.current.has(currentTopic.id);
        setShowSponsorCard(false);
        setShowTopCommentCard(true);
        return;
      }
      if (cachedSponsor?.campaigns.length) {
        activateInterstitialTopic(currentTopic.id);
        sponsorPreviousIsComment.current = false;
        sponsorIsPreviousEntry.current = false;
        setSponsorCampaigns(cachedSponsor.campaigns);
        setActiveSponsorSessionId(cachedSponsor.sessionId);
        setShowTopCommentCard(false);
        setShowSponsorCard(true);
        return;
      }
      if (sponsorDueByTopicId.current.has(currentTopic.id)) {
        activateInterstitialTopic(currentTopic.id);
        sponsorRequestPreviousCadence.current = topicsSinceSponsorCard;
        setTopicsSinceSponsorCard(0);
        sponsorLoadingRef.current = true;
        setSponsorLoading(true);
        const requestedUserId = userId;
        const requestVersion = ++sponsorRequestVersion.current;
        try {
          const result = await getSponsorCampaignResult(currentTopic);
          if (sponsorRequestVersion.current !== requestVersion ||
              sponsorSessionUserId.current !== requestedUserId) return;
          if (!result.retryable) sponsorDueByTopicId.current.delete(currentTopic.id);
          const sessionId = result.sessionId;
          if (result.campaigns.length > 0 && sessionId) {
            sponsorPreviousIsComment.current = false;
            flushSync(() => {
              setSponsorCampaigns(result.campaigns);
              setActiveSponsorSessionId(sessionId);
              sponsorCardsByTopicId.current.set(currentTopic.id, {
                campaigns: result.campaigns,
                sessionId,
              });
              setShowSponsorCard(true);
              setSponsorLoading(false);
            });
          } else {
            flushSync(() => {
              setSponsorLoading(false);
              advanceToNextTopic();
            });
          }
        } finally {
          if (sponsorRequestVersion.current === requestVersion) {
            sponsorLoadingRef.current = false;
            setSponsorLoading(false);
          }
        }
        return;
      }
    }

    // Never strand the user on an interstitial at the end of a page while the
    // next topic page is still loading.
    if (topicIndex >= feedTopics.length - 1 && nextCursor) {
      pendingAdvanceAfterPageRef.current = true;
      void loadMoreTopics();
      return;
    }

    let currentCommentCadence = topicsSinceTopCommentCard;
    let currentSponsorCadence = topicsSinceSponsorCard;

    if (seenTopCommentUserId.current !== userId) {
      seenTopCommentUserId.current = userId;
      seenTopCommentIds.current.clear();
      topCommentCardsByTopicId.current.clear();
      topCommentIndexByTopicId.current.clear();
      processedTopicBoundariesByTopicId.current.clear();
      sponsorDueByTopicId.current.clear();
      currentCommentCadence = 0;
    }

    if (topCommentCadenceUserId.current !== userId) {
      topCommentCadenceUserId.current = userId;
      currentCommentCadence = 0;
    }

    if (sponsorSessionUserId.current !== userId) {
      sponsorSessionUserId.current = userId;
      setActiveSponsorSessionId(null);
      sponsorCardsByTopicId.current.clear();
      sponsorDueByTopicId.current.clear();
      currentSponsorCadence = 0;
    }

    // A topic boundary is evaluated once per feed session. Replaying a topic
    // with no interstitial must not consume the cadence at the new frontier
    // and unexpectedly insert a card into the user's already-seen sequence.
    if (currentTopic && processedTopicBoundariesByTopicId.current.has(currentTopic.id)) {
      advanceToNextTopic();
      return;
    }

    const unseenTopComments = getUnseenTopFeedComments(
      topComments,
      seenTopCommentIds.current
    );
    if (unseenTopComments.length <= 10 && topCommentsNextOffsetRef.current !== null) {
      void loadMoreTopComments();
    }
    const commentDue = shouldInsertTopCommentCard(
      currentCommentCadence,
      unseenTopComments.length > 0
    );
    const sponsorDue = shouldInsertSponsorCard(currentSponsorCadence, Boolean(userId));
    const nextCommentCadence = getNextTopCommentCadence(currentCommentCadence);
    const nextSponsorCadence = getNextSponsorCadence(currentSponsorCadence);
    // Keep the two cadences independent. If both are due, show the comment
    // first and then the sponsor placement at the same topic boundary.
    const chooseSponsor = sponsorDue && !commentDue;

    if (chooseSponsor) {
      activateInterstitialTopic(currentTopic?.id ?? null);
      sponsorIsPreviousEntry.current = false;
      if (currentTopic) {
        processedTopicBoundariesByTopicId.current.add(currentTopic.id);
        sponsorDueByTopicId.current.add(currentTopic.id);
      }
      setTopicsSinceTopCommentCard(nextCommentCadence);
      sponsorRequestPreviousCadence.current = topicsSinceSponsorCard;
      setTopicsSinceSponsorCard(0);

      if (!currentTopic) {
        advanceToNextTopic();
        return;
      }

      sponsorPreviousIsComment.current = false;
      const preparedSponsor = sponsorResultsByTopicId.current.get(currentTopic.id);
      sponsorLoadingRef.current = true;
      if (!preparedSponsor) setSponsorLoading(true);
      const requestedUserId = userId;
      const requestVersion = ++sponsorRequestVersion.current;
      try {
        const result = await getSponsorCampaignResult(currentTopic);
        if (sponsorRequestVersion.current !== requestVersion ||
            sponsorSessionUserId.current !== requestedUserId) return;
        const sessionId = result.sessionId;
        if (result.campaigns.length > 0 && sessionId) {
          sponsorPreviousIsComment.current = false;
          sponsorDueByTopicId.current.delete(currentTopic.id);
          flushSync(() => {
            setSponsorCampaigns(result.campaigns);
            setActiveSponsorSessionId(sessionId);
            sponsorCardsByTopicId.current.set(currentTopic.id, {
              campaigns: result.campaigns,
              sessionId,
            });
            setShowTopCommentCard(false);
            setShowSponsorCard(true);
            setSponsorLoading(false);
          });
          return;
        }

        if (!result.retryable) sponsorDueByTopicId.current.delete(currentTopic.id);
        flushSync(() => {
          setSponsorLoading(false);
          advanceToNextTopic();
        });
      } finally {
        if (sponsorRequestVersion.current === requestVersion) {
          sponsorLoadingRef.current = false;
          setSponsorLoading(false);
        }
      }
      return;
    }

    setTopicsSinceSponsorCard(sponsorDue ? currentSponsorCadence : nextSponsorCadence);

    if (commentDue) {
      pendingSponsorAfterComment.current = sponsorDue;
      setTopicsSinceTopCommentCard(0);
      if (currentTopic) {
        processedTopicBoundariesByTopicId.current.add(currentTopic.id);
        if (sponsorDue) sponsorDueByTopicId.current.add(currentTopic.id);
      }
      if (currentTopic) {
        sponsorPreviousIsComment.current = false;
        topCommentIsPreviousEntry.current = false;
        const commentGroup = getTopCommentGroup(unseenTopComments);
        // Reserve only this five-comment group. Remaining unseen comments stay
        // eligible for later topic boundaries, while this exact group replays
        // unchanged when the user navigates backward and forward.
        for (const comment of commentGroup) {
          seenTopCommentIds.current.add(comment.comment_id);
        }
        setTopCommentCardComments(commentGroup);
        topCommentCardsByTopicId.current.set(currentTopic.id, commentGroup);
        topCommentIndexByTopicId.current.set(currentTopic.id, 0);
        activateInterstitialTopic(currentTopic.id);
        setShowSponsorCard(false);
        setShowTopCommentCard(true);

        // Prefetch the sponsor at the same topic boundary while the comment
        // card is being read. The following card can then appear immediately.
        if (sponsorDue) void getSponsorCampaignResult(currentTopic);
        return;
      }
    }

    if (currentTopic) processedTopicBoundariesByTopicId.current.add(currentTopic.id);
    setTopicsSinceTopCommentCard(nextCommentCadence);
    advanceToNextTopic();
  };

  const markTopCommentViewed = useCallback(
    (commentId: number) => {
      if (seenTopCommentUserId.current !== userId) {
        seenTopCommentUserId.current = userId;
        seenTopCommentIds.current.clear();
        topCommentCardsByTopicId.current.clear();
        topCommentIndexByTopicId.current.clear();
        processedTopicBoundariesByTopicId.current.clear();
        sponsorDueByTopicId.current.clear();
      }
      seenTopCommentIds.current.add(commentId);
    },
    [userId]
  );

  const openTopComment = (comment: TopFeedComment) => {
    onOpenComment(comment);
  };

  const previousTopic = () => {
    pendingAdvanceAfterPageRef.current = false;
    if (sponsorLoadingRef.current) {
      sponsorRequestVersion.current += 1;
      sponsorLoadingRef.current = false;
      setSponsorLoading(false);
      setTopicsSinceSponsorCard(sponsorRequestPreviousCadence.current);
    }
    pendingSponsorAfterComment.current = false;
    if (seenTopCommentUserId.current !== userId) {
      seenTopCommentUserId.current = userId;
      seenTopCommentIds.current.clear();
      topCommentCardsByTopicId.current.clear();
      topCommentIndexByTopicId.current.clear();
    }

    const previousIndex = (topicIndex - 1 + feedTopics.length) % feedTopics.length;
    const previousTopicId = feedTopics[previousIndex]?.id;
    const previousSponsorCard = previousTopicId
      ? sponsorCardsByTopicId.current.get(previousTopicId)
      : undefined;
    const previousCard = previousTopicId
      ? topCommentCardsByTopicId.current.get(previousTopicId)
      : undefined;

    if (previousSponsorCard?.campaigns.length) {
      activateInterstitialTopic(previousTopicId ?? null);
      sponsorPreviousIsComment.current = Boolean(previousCard?.length);
      sponsorIsPreviousEntry.current = true;
      topCommentIsPreviousEntry.current = Boolean(previousCard?.length);
      pendingSponsorAfterComment.current = Boolean(previousCard?.length);
      if (previousCard?.length) {
        setTopCommentCardComments(previousCard);
      }
      setSponsorCampaigns(previousSponsorCard.campaigns);
      setActiveSponsorSessionId(previousSponsorCard.sessionId);
      setShowTopCommentCard(false);
      setShowSponsorCard(true);
      return;
    }

    if (previousCard?.length) {
      activateInterstitialTopic(previousTopicId ?? null);
      sponsorPreviousIsComment.current = false;
      // We are traversing backward from the following topic. Leaving this
      // comment card backward must therefore move to the previous topic;
      // leaving it forward must return to the following topic.
      topCommentIsPreviousEntry.current = true;
      sponsorIsPreviousEntry.current = false;
      pendingSponsorAfterComment.current = sponsorDueByTopicId.current.has(previousTopicId ?? '');
      setTopCommentCardComments(previousCard);
      setShowTopCommentCard(true);
      return;
    }

    topCommentIsPreviousEntry.current = false;
    sponsorIsPreviousEntry.current = false;
    sponsorPreviousIsComment.current = false;
    setTopicIndex(previousIndex);
  };

  const currentTopCommentIds = new Set(topComments.map((comment) => comment.comment_id));
  const activeTopCommentCardComments = topCommentCardComments.filter((comment) =>
    currentTopCommentIds.has(comment.comment_id)
  );

  // ----------------------------------
  // Loading
  // ----------------------------------

  if (!feedTopics.length) {
    return null;
  }

  return (
    <div className="h-full">
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
      {sponsorLoading ? (
        <SponsorLoadingCard
          onNextTopic={() => {
            sponsorRequestVersion.current += 1;
            sponsorLoadingRef.current = false;
            setSponsorLoading(false);
            const interstitialTopicId = activeInterstitialTopicIdRef.current;
            if (interstitialTopicId) sponsorDueByTopicId.current.delete(interstitialTopicId);
            pendingSponsorAfterComment.current = false;
            sponsorPreviousIsComment.current = false;
            const wasPreviousEntry = sponsorIsPreviousEntry.current;
            sponsorIsPreviousEntry.current = false;
            topCommentIsPreviousEntry.current = false;
            activateInterstitialTopic(null);
            setShowTopCommentCard(false);
            if (!wasPreviousEntry) advanceToNextTopic();
          }}
          onPreviousTopic={() => {
            sponsorRequestVersion.current += 1;
            sponsorLoadingRef.current = false;
            setSponsorLoading(false);
            setTopicsSinceSponsorCard(sponsorRequestPreviousCadence.current);
            const previousWasComment = sponsorPreviousIsComment.current;
            const wasPreviousEntry = sponsorIsPreviousEntry.current;
            sponsorPreviousIsComment.current = false;
            sponsorIsPreviousEntry.current = false;
            if (previousWasComment) {
              setShowTopCommentCard(true);
            } else {
              activateInterstitialTopic(null);
              if (wasPreviousEntry) {
                setTopicIndex((previous) => (previous - 1 + feedTopics.length) % feedTopics.length);
              }
            }
          }}
        />
      ) : showSponsorCard && sponsorCampaigns.length > 0 ? (
        <SponsorFeedCard
          campaigns={sponsorCampaigns}
          sessionId={activeSponsorSessionId ?? ''}
          userId={userId ?? ''}
          sponsorApiBaseUrl={effectiveSponsorApiBaseUrl}
          getAccessToken={getSponsorAccessToken ?? (async () => null)}
          onNextTopic={() => {
            setShowSponsorCard(false);
            const wasPreviousEntry = sponsorIsPreviousEntry.current;
            sponsorIsPreviousEntry.current = false;
            sponsorPreviousIsComment.current = false;
            topCommentIsPreviousEntry.current = false;
            activateInterstitialTopic(null);
            if (!wasPreviousEntry) advanceToNextTopic();
          }}
          onPreviousTopic={() => {
            setShowSponsorCard(false);
            const previousWasComment = sponsorPreviousIsComment.current;
            const wasPreviousEntry = sponsorIsPreviousEntry.current;
            sponsorPreviousIsComment.current = false;
            sponsorIsPreviousEntry.current = false;
            if (previousWasComment) {
              setShowTopCommentCard(true);
            } else {
              activateInterstitialTopic(null);
              if (wasPreviousEntry) {
                setTopicIndex((previous) => (previous - 1 + feedTopics.length) % feedTopics.length);
              }
            }
          }}
        />
      ) : showTopCommentCard && activeTopCommentCardComments.length > 0 ? (
        <TopCommentFeedCard
          key={userId ?? 'anonymous'}
          userId={userId}
          comments={activeTopCommentCardComments}
          initialActiveIndex={activeTopCommentIndex}
          onActiveIndexChange={(index) => {
            setActiveTopCommentIndex(index);
            const topicId = activeInterstitialTopicIdRef.current;
            if (topicId) topCommentIndexByTopicId.current.set(topicId, index);
          }}
          onCommentViewed={markTopCommentViewed}
          onNextTopic={async () => {
            if (sponsorLoadingRef.current) return;
            const commentWasPreviousEntry = topCommentIsPreviousEntry.current;
            const interstitialTopicId = activeInterstitialTopicIdRef.current;
            const currentTopic = interstitialTopicId
              ? feedTopics.find((topic) => topic.id === interstitialTopicId)
              : undefined;
            const cachedSponsor = currentTopic
              ? sponsorCardsByTopicId.current.get(currentTopic.id)
              : undefined;
            const shouldShowSponsorAfterComment = pendingSponsorAfterComment.current;
            pendingSponsorAfterComment.current = false;

            if (cachedSponsor?.campaigns.length) {
              sponsorPreviousIsComment.current = true;
              sponsorIsPreviousEntry.current = commentWasPreviousEntry;
              setSponsorCampaigns(cachedSponsor.campaigns);
              setActiveSponsorSessionId(cachedSponsor.sessionId);
              setShowTopCommentCard(false);
              setShowSponsorCard(true);
              return;
            }

            if (!shouldShowSponsorAfterComment) {
              setShowTopCommentCard(false);
              topCommentIsPreviousEntry.current = false;
              activateInterstitialTopic(null);
              if (!commentWasPreviousEntry) advanceToNextTopic();
              return;
            }

            if (!currentTopic) {
              setShowTopCommentCard(false);
              setTopicsSinceSponsorCard(0);
              topCommentIsPreviousEntry.current = false;
              activateInterstitialTopic(null);
              if (!commentWasPreviousEntry) advanceToNextTopic();
              return;
            }

            sponsorPreviousIsComment.current = true;
            sponsorIsPreviousEntry.current = commentWasPreviousEntry;
            const preparedSponsor = sponsorResultsByTopicId.current.get(currentTopic.id);
            sponsorLoadingRef.current = true;
            if (!preparedSponsor) setSponsorLoading(true);
            sponsorRequestPreviousCadence.current = topicsSinceSponsorCard;
            const requestedUserId = userId;
            const requestVersion = ++sponsorRequestVersion.current;
            try {
              const result = await getSponsorCampaignResult(currentTopic);
              if (sponsorRequestVersion.current !== requestVersion ||
                  sponsorSessionUserId.current !== requestedUserId) return;
              setTopicsSinceSponsorCard(0);
              if (result.campaigns.length > 0 && result.sessionId) {
                sponsorPreviousIsComment.current = true;
                sponsorCardsByTopicId.current.set(currentTopic.id, {
                  campaigns: result.campaigns,
                  sessionId: result.sessionId,
                });
                sponsorResultsByTopicId.current.set(currentTopic.id, result);
                sponsorDueByTopicId.current.delete(currentTopic.id);
                flushSync(() => {
                  setSponsorCampaigns(result.campaigns);
                  setActiveSponsorSessionId(result.sessionId);
                  setShowTopCommentCard(false);
                  setShowSponsorCard(true);
                  setSponsorLoading(false);
                });
                return;
              }

              if (!result.retryable) sponsorDueByTopicId.current.delete(currentTopic.id);
              flushSync(() => {
                setShowTopCommentCard(false);
                setSponsorLoading(false);
                topCommentIsPreviousEntry.current = false;
                activateInterstitialTopic(null);
                if (!commentWasPreviousEntry) advanceToNextTopic();
              });
            } finally {
              if (sponsorRequestVersion.current === requestVersion) {
                sponsorLoadingRef.current = false;
                setSponsorLoading(false);
              }
            }
          }}
          onPreviousTopic={() => {
            if (sponsorLoadingRef.current) {
              sponsorRequestVersion.current += 1;
              sponsorLoadingRef.current = false;
              setSponsorLoading(false);
              setTopicsSinceSponsorCard(sponsorRequestPreviousCadence.current);
            }
            pendingSponsorAfterComment.current = false;
            const wasPreviousEntry = topCommentIsPreviousEntry.current;
            topCommentIsPreviousEntry.current = false;
            sponsorIsPreviousEntry.current = false;
            // When the comment was reached by swiping backward from a later
            // topic, leaving it backward must continue to the earlier topic.
            setShowTopCommentCard(false);
            activateInterstitialTopic(null);
            if (wasPreviousEntry) {
              setTopicIndex((previous) => (previous - 1 + feedTopics.length) % feedTopics.length);
            }
          }}
          onOpenComment={openTopComment}
        />
      ) : (
        <Viewer
          topics={feedTopics}
          topicIndex={topicIndex}
          initialUserId={userId}
          onNextTopic={nextTopic}
          onPreviousTopic={previousTopic}
        />
      )}
    </div>
  );
}
