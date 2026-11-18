'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';

import { shuffle } from '@/lib/utils';
import {
  getUnseenTopFeedComments,
  parseTopFeedComments,
  type TopFeedComment,
} from '@/lib/feed-comments';
import {
  parseSponsorFeedCampaigns,
  type SponsorFeedCampaign,
} from '@/lib/sponsor-campaigns';
import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator';
import { siteConfig } from '@/lib/constants';
import { buildFeedEntryMap, flattenFeedEntryMap, type FeedEntry, type FeedEntryMap } from '@/lib/feed-entry-map';
import { renderRegisteredFeedEntry, type FeedEntryLike } from '@/lib/feed-entry-registry';
import { createFeedCardRegistry } from './feed-card-registry';
import { getAdjacentFeedEntry, getFeedEntryKey, reconcileFeedEntryCursor } from '@/lib/feed-entry-cursor';

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
  const seenTopCommentIds = useRef(new Set<number>());
  const seenTopCommentUserId = useRef(userId);
  const topCommentCadenceUserId = useRef(userId);
  const topCommentCardsByTopicId = useRef(new Map<string, TopFeedComment[]>());
  const topCommentIndexByTopicId = useRef(new Map<string, number>());
  const processedTopicBoundariesByTopicId = useRef(new Set<string>());
  const feedEntryMapRef = useRef<FeedEntryMap | null>(null);
  const [topicsSinceTopCommentCard, setTopicsSinceTopCommentCard] = useState(0);
  const topicsSinceTopCommentCardRef = useRef(0);
  const [, setSponsorLoading] = useState(false);
  const [topicsSinceSponsorCard, setTopicsSinceSponsorCard] = useState(0);
  const topicsSinceSponsorCardRef = useRef(0);
  const sponsorCardsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string }>());
  const sponsorResultsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string | null }>());
  const sponsorRequestsByTopicId = useRef(new Map<string, Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }>>());

  useEffect(() => {
    topicsSinceTopCommentCardRef.current = topicsSinceTopCommentCard;
  }, [topicsSinceTopCommentCard]);

  useEffect(() => {
    topicsSinceSponsorCardRef.current = topicsSinceSponsorCard;
  }, [topicsSinceSponsorCard]);
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
  const [activeFeedEntryKey, setActiveFeedEntryKeyState] = useState<string | null>(null);
  const activeFeedEntryKeyRef = useRef<string | null>(null);
  const setActiveFeedEntryKey = useCallback((key: string | null) => {
    activeFeedEntryKeyRef.current = key;
    setActiveFeedEntryKeyState(key);
  }, []);
  const isTopCommentCardActive = () => activeFeedEntryKeyRef.current?.startsWith('top-comments:') ?? false;
  const isSponsorCardActive = () => activeFeedEntryKeyRef.current?.startsWith('sponsor:') ?? false;
  const activateTopCommentEntry = (topicId = activeInterstitialTopicIdRef.current) => {
    if (topicId) setActiveFeedEntryKey(`top-comments:${topicId}`);
  };
  const activateSponsorEntry = (topicId = activeInterstitialTopicIdRef.current) => {
    if (topicId) setActiveFeedEntryKey(`sponsor:${topicId}`);
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
    seenTopCommentUserId.current = userId;
    topCommentCadenceUserId.current = userId;
    seenTopCommentIds.current.clear();
    topCommentCardsByTopicId.current.clear();
    topCommentIndexByTopicId.current.clear();
    processedTopicBoundariesByTopicId.current.clear();
    feedEntryMapRef.current = null;
    activeInterstitialTopicIdRef.current = null;
    sponsorCardsByTopicId.current.clear();
    sponsorResultsByTopicId.current.clear();
    sponsorRequestsByTopicId.current.clear();
    sponsorDueByTopicId.current.clear();
    sponsorRequestVersion.current += 1;
    sponsorLoadingRef.current = false;
    pendingSponsorAfterComment.current = false;
    setActiveFeedEntryKey(null);
    setActiveTopCommentIndex(0);
    setSponsorLoading(false);
    setTopicsSinceSponsorCard(0);
    setTopicsSinceTopCommentCard(0);
    topicsSinceSponsorCardRef.current = 0;
    topicsSinceTopCommentCardRef.current = 0;
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
            setActiveFeedEntryKey(null);
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

  const prefetchMappedSponsor = useCallback((topicId: string) => {
    const boundary = feedEntryMapRef.current?.byTopicId.get(topicId);
    const entry = boundary?.entries.find((item) => item.type === 'sponsor');
    if (!entry || entry.type !== 'sponsor' || entry.status !== 'pending') return;
    const topic = feedTopicsRef.current.find((item) => item.id === topicId);
    if (!topic) return;
    const requestedUserId = userId;

    void getSponsorCampaignResult(topic).then((result) => {
      if (
        result.retryable ||
        userId !== requestedUserId ||
        sponsorSessionUserId.current !== requestedUserId
      ) return;
      const currentBoundary = feedEntryMapRef.current?.byTopicId.get(topicId);
      if (!currentBoundary) return;
      const currentSponsor = currentBoundary.entries.find((item) => item.type === 'sponsor');
      if (!currentSponsor || currentSponsor.type !== 'sponsor') return;
      if (result.campaigns.length > 0 && result.sessionId) {
        currentSponsor.campaigns = result.campaigns;
        currentSponsor.sessionId = result.sessionId;
        currentSponsor.status = 'ready';
      } else {
        currentBoundary.entries = currentBoundary.entries.filter((item) => item.type !== 'sponsor');
      }
    });
  }, [getSponsorCampaignResult, userId]);

  // Build the ordered topic/comment/sponsor map ahead of navigation. The
  // original analytics-ranked topic array remains the source of truth; each
  // topic boundary owns its interstitial entries in this single map.
  useEffect(() => {
    if (feedTopics.length === 0) {
      feedEntryMapRef.current = null;
      return;
    }

    const activeTopicId = activeInterstitialTopicIdRef.current;
    const currentId = currentTopicId.current;
    const currentIndex = currentId
      ? feedTopics.findIndex((topic) => topic.id === currentId)
      : 0;
    const activeIndex = activeTopicId
      ? feedTopics.findIndex((topic) => topic.id === activeTopicId)
      : -1;
    const startIndex = activeIndex >= 0
      ? activeIndex + 1
      : Math.max(0, currentIndex);
    const previousMap = feedEntryMapRef.current;
    const commentsById = new Map(
      topComments.map((comment) => [comment.comment_id, comment] as const)
    );
    const prefix = previousMap
      ? previousMap.boundaries
          .filter((boundary) => {
            const index = feedTopics.findIndex((topic) => topic.id === boundary.topicId);
            return index >= 0 && index < startIndex;
          })
          .map((boundary) => ({
            ...boundary,
            entries: boundary.entries.flatMap<import('@/lib/feed-entry-map').FeedEntry>((entry) => {
              if (entry.type !== 'top-comments') return [entry];
              const currentComments = entry.comments.flatMap((comment) => {
                const currentComment = commentsById.get(comment.comment_id);
                return currentComment ? [currentComment] : [];
              });
              return currentComments.length > 0
                ? [{ ...entry, comments: currentComments }]
                : [];
            }),
          }))
      : [];
    const unseenComments = getUnseenTopFeedComments(topComments, seenTopCommentIds.current);
    if (unseenComments.length <= 10 && topCommentsNextOffsetRef.current !== null) {
      void loadMoreTopComments();
    }
    const planned = buildFeedEntryMap({
      topics: feedTopics.slice(startIndex),
      comments: unseenComments,
      seenCommentIds: seenTopCommentIds.current,
      userId,
      commentCadence: topicsSinceTopCommentCardRef.current,
      sponsorCadence: topicsSinceSponsorCardRef.current,
      sponsorResults: sponsorResultsByTopicId.current,
    });
    const boundaries = [...prefix, ...planned.boundaries];
    const byTopicId = new Map(boundaries.map((boundary) => [boundary.topicId, boundary] as const));
    feedEntryMapRef.current = {
      ...planned,
      boundaries,
      byTopicId,
    };
    for (const boundary of planned.boundaries) {
      const sponsorEntry = boundary.entries.find((entry) => entry.type === 'sponsor');
      if (sponsorEntry && sponsorEntry.type === 'sponsor' && sponsorEntry.status !== 'empty') {
        sponsorDueByTopicId.current.add(boundary.topicId);
      } else {
        sponsorDueByTopicId.current.delete(boundary.topicId);
      }
    }

    // Resolve only the next sponsor slot. Fetching every future campaign
    // would consume per-user delivery caps for cards the user may never reach.
    const firstSponsor = planned.boundaries
      .flatMap((boundary) => boundary.entries)
      .find((entry) => entry.type === 'sponsor');
    if (firstSponsor && firstSponsor.type === 'sponsor' && firstSponsor.status === 'pending') {
      prefetchMappedSponsor(firstSponsor.topicId);
    }
  }, [feedTopics, topComments, userId, getSponsorCampaignResult, prefetchMappedSponsor, loadMoreTopComments]);

  // Keep a cursor for every active feed entry, including ordinary topics.
  useEffect(() => {
    if (activeFeedEntryKey?.startsWith('top-comments:') || activeFeedEntryKey?.startsWith('sponsor:')) return;
    const currentTopic = feedTopics[topicIndex];
    const nextKey = currentTopic ? `topic:${currentTopic.id}` : null;
    if (nextKey !== activeFeedEntryKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveFeedEntryKey(nextKey);
    }
  }, [activeFeedEntryKey, feedTopics, topicIndex, setActiveFeedEntryKey]);

  // If a card disappears during inventory refresh, fall back to its topic anchor.
  useEffect(() => {
    if (
      !activeFeedEntryKey ||
      (!activeFeedEntryKey.startsWith('top-comments:') && !activeFeedEntryKey.startsWith('sponsor:')) ||
      !activeInterstitialTopicIdRef.current
    ) return;
    const entries = feedEntryMapRef.current
      ? flattenFeedEntryMap(feedEntryMapRef.current)
      : [];
    const cursor = reconcileFeedEntryCursor(
      entries,
      activeFeedEntryKey,
      activeInterstitialTopicIdRef.current
    );
    if (cursor?.key === activeFeedEntryKey) return;
    activeFeedEntryKeyRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveFeedEntryKeyState(null);
    if (cursor?.key.startsWith('topic:')) {
      const topicId = cursor.key.slice('topic:'.length);
      const index = feedTopics.findIndex((topic) => topic.id === topicId);
      if (index >= 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTopicIndex(index);
      }
    }
    activeInterstitialTopicIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTopCommentIndex(0);
  }, [activeFeedEntryKey, feedTopics, topComments, userId]);

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
    const currentTopicId = feedTopics[topicIndex]?.id;
    const boundaries = feedEntryMapRef.current?.boundaries ?? [];
    const currentBoundaryIndex = boundaries.findIndex((boundary) => boundary.topicId === currentTopicId);
    const nextSponsorBoundary = boundaries
      .slice(Math.max(0, currentBoundaryIndex + 1))
      .find((boundary) => boundary.entries.some((entry) => entry.type === 'sponsor'));
    const nextSponsorEntry = nextSponsorBoundary?.entries.find((entry) => entry.type === 'sponsor');
    if (nextSponsorBoundary && nextSponsorEntry?.type === 'sponsor' && nextSponsorEntry.status === 'pending') {
      prefetchMappedSponsor(nextSponsorBoundary.topicId);
    }
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

  const activateFeedEntry = async (
    entry: FeedEntry,
    direction: 'next' | 'previous',
    entries: readonly FeedEntry[]
  ) => {
    const entryKey = getFeedEntryKey(entry);
    setActiveFeedEntryKey(entryKey);

    if (entry.type === 'topic') {
      activateInterstitialTopic(null);
      const index = feedTopics.findIndex((topic) => topic.id === entry.topicId);
      if (index >= 0) setTopicIndex(index);
      return;
    }

    activateInterstitialTopic(entry.topicId);

    if (entry.type === 'top-comments') {
      for (const comment of entry.comments) {
        seenTopCommentIds.current.add(comment.comment_id);
      }
      topCommentCardsByTopicId.current.set(entry.topicId, entry.comments);
      if (!topCommentIndexByTopicId.current.has(entry.topicId)) {
        topCommentIndexByTopicId.current.set(entry.topicId, 0);
      }
      return;
    }

    if (entry.type === 'sponsor') {
      if (entry.status === 'ready' && entry.campaigns.length > 0 && entry.sessionId) return;
      if (entry.status === 'empty') {
        const boundary = feedEntryMapRef.current?.byTopicId.get(entry.topicId);
        if (boundary) {
          boundary.entries = boundary.entries.filter((candidate) => candidate.type !== 'sponsor');
        }
      } else if (entry.status === 'pending') {
        const sponsorTopic = feedTopics.find((topic) => topic.id === entry.topicId);
        if (!sponsorTopic) return;

        sponsorLoadingRef.current = true;
        setSponsorLoading(true);
        const requestedUserId = userId;
        const requestVersion = ++sponsorRequestVersion.current;
        try {
          const result = await getSponsorCampaignResult(sponsorTopic);
          if (
            sponsorRequestVersion.current !== requestVersion ||
            sponsorSessionUserId.current !== requestedUserId
          ) return;

          if (result.campaigns.length > 0 && result.sessionId) {
            entry.campaigns = result.campaigns;
            entry.sessionId = result.sessionId;
            entry.status = 'ready';
            sponsorCardsByTopicId.current.set(entry.topicId, {
              campaigns: result.campaigns,
              sessionId: result.sessionId,
            });
            sponsorResultsByTopicId.current.set(entry.topicId, result);
            sponsorDueByTopicId.current.delete(entry.topicId);
            setSponsorLoading(false);
            return;
          }

          if (!result.retryable) {
            entry.status = 'empty';
            const boundary = feedEntryMapRef.current?.byTopicId.get(entry.topicId);
            if (boundary) {
              boundary.entries = boundary.entries.filter((candidate) => candidate.type !== 'sponsor');
            }
          }

          const adjacent = getAdjacentFeedEntry(entries, entryKey, direction);
          if (adjacent) {
            await activateFeedEntry(adjacent.entry, direction, entries);
          } else if (direction === 'next') {
            setActiveFeedEntryKey(null);
            advanceToNextTopic();
          } else {
            setActiveFeedEntryKey(null);
            const previousIndex = Math.max(0, feedTopics.findIndex((topic) => topic.id === entry.topicId) - 1);
            setTopicIndex(previousIndex);
            activateInterstitialTopic(null);
          }
        } finally {
          if (sponsorRequestVersion.current === requestVersion) {
            sponsorLoadingRef.current = false;
            setSponsorLoading(false);
          }
        }
      }
      return;
    }

    // Future registered card types need only a placement rule and renderer.
    // Their own component owns any additional card-specific interaction state.
    void direction;
    void entries;
  };

  const navigateFeedEntry = async (direction: 'next' | 'previous') => {
    const entries = feedEntryMapRef.current
      ? flattenFeedEntryMap(feedEntryMapRef.current)
      : [];
    const currentTopic = feedTopics[topicIndex];
    const currentKey = activeFeedEntryKeyRef.current ?? (
      currentTopic
        ? getFeedEntryKey({ type: 'topic', topicId: currentTopic.id, topic: currentTopic })
        : ''
    );
    if (!currentKey) return;

    const currentEntry = entries.find((entry) => getFeedEntryKey(entry) === currentKey);
    if (direction === 'next' && currentEntry?.type === 'topic' && currentTopic) {
      const boundary = feedEntryMapRef.current?.byTopicId.get(currentTopic.id);
      if (boundary && !processedTopicBoundariesByTopicId.current.has(currentTopic.id)) {
        processedTopicBoundariesByTopicId.current.add(currentTopic.id);
        topicsSinceTopCommentCardRef.current = boundary.commentCadenceAfter;
        topicsSinceSponsorCardRef.current = boundary.sponsorCadenceAfter;
      }
    }

    if (currentEntry?.type === 'sponsor' && sponsorLoadingRef.current) {
      sponsorRequestVersion.current += 1;
      sponsorLoadingRef.current = false;
      setSponsorLoading(false);
    }

    const adjacent = getAdjacentFeedEntry(entries, currentKey, direction);
    if (!adjacent) {
      if (direction === 'next') {
        advanceToNextTopic();
      } else if (feedTopics.length > 0) {
        const lastIndex = feedTopics.length - 1;
        const lastTopic = feedTopics[lastIndex];
        if (lastTopic) setActiveFeedEntryKey(getFeedEntryKey({
          type: 'topic',
          topicId: lastTopic.id,
          topic: lastTopic,
        }));
        activateInterstitialTopic(null);
        setTopicIndex(lastIndex);
      }
      return;
    }

    if (adjacent.entry.type === 'topic') {
      if (direction === 'next') {
        advanceToNextTopic();
      } else {
        setActiveFeedEntryKey(getFeedEntryKey(adjacent.entry));
        activateInterstitialTopic(null);
        const index = feedTopics.findIndex((topic) => topic.id === adjacent.entry.topicId);
        if (index >= 0) setTopicIndex(index);
      }
      return;
    }

    await activateFeedEntry(adjacent.entry, direction, entries);
  };

  const nextTopic = () => navigateFeedEntry('next');
  const previousTopic = () => navigateFeedEntry('previous');

  const openTopComment = (comment: TopFeedComment) => {
    onOpenComment(comment);
  };

  const flattenedEntries = feedEntryMapRef.current
    ? flattenFeedEntryMap(feedEntryMapRef.current)
    : [];
  const activeMappedEntry = activeFeedEntryKey
    ? flattenedEntries.find((entry) => getFeedEntryKey(entry) === activeFeedEntryKey)
    : null;
  const activeFeedCardEntry: FeedEntry | null =
    activeMappedEntry && activeMappedEntry.type !== 'topic'
      ? activeMappedEntry
      : null;

  const feedCardRendererContext = {
    userId,
    sponsorApiBaseUrl: effectiveSponsorApiBaseUrl,
    getSponsorAccessToken,
    activeTopCommentIndex,
    onTopCommentIndexChange: (topicId: string, index: number) => {
      setActiveTopCommentIndex(index);
      topCommentIndexByTopicId.current.set(topicId, index);
    },
    onCommentViewed: markTopCommentViewed,
    onOpenComment: openTopComment,
    onNext: () => nextTopic(),
    onPrevious: () => previousTopic(),
  };
  const feedCardRenderers = createFeedCardRegistry(feedCardRendererContext);
  const renderedFeedCard = activeFeedCardEntry
    ? renderRegisteredFeedEntry(activeFeedCardEntry, feedCardRenderers, feedCardRendererContext)
    : null;

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
      {renderedFeedCard ?? (
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
