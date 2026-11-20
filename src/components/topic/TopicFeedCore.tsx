'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

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
import { analyticsConsentChangeEvent, hasAnalyticsConsent } from '@/lib/analytics-consent';
import { buildFeedEntryMap, collectReservedCommentIds, flattenFeedEntryMap, reconcileFeedBoundary, type FeedEntry, type FeedEntryMap } from '@/lib/feed-entry-map';
import {
  invokeRegisteredFeedEntryLifecycle,
  renderRegisteredFeedEntry,
  type FeedEntryDirection,
  type FeedEntryLike,
} from '@/lib/feed-entry-registry';
import { createFeedCardRegistry } from './feed-card-registry';
import { FeedProgress } from './FeedProgress';
import { FeedRenderer } from './FeedRenderer';
import { TopicCard } from './TopicCard';
import type { FeedCardRendererContext } from './feed-card-registry.types';
import { getAdjacentFeedEntry, getFeedEntryKey, reconcileFeedEntryCursor } from '@/lib/feed-entry-cursor';

import type { GeneralFeedCursor, TopicPageCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import { Topic } from '@/types';

type FeedCursor = TopicPageCursor | GeneralFeedCursor | RecommendationCursor;
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

let ephemeralSponsorSessionId: string | null = null;

function createSponsorPlacementId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null;
}

function createSponsorSessionId(): string | null {
  if (ephemeralSponsorSessionId) return ephemeralSponsorSessionId;
  ephemeralSponsorSessionId = createSponsorPlacementId();
  return ephemeralSponsorSessionId;
}
type ViewerProps = {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  active?: boolean;
  onNextTopic: () => void | Promise<void>;
  onPreviousTopic: () => void | Promise<void>;
  onProgressChange: (current: number, total: number) => void;
  nextEntryPreview?: ReactNode;
  previousEntryPreview?: ReactNode;
};
type TopicFeedCoreProps = {
  topics: Topic[];
  nextCursor: FeedCursor | null;
  personalized: boolean;
  generalRanked?: boolean;
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
  generalRanked = false,
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
  const topicsSinceTopCommentCardRef = useRef(0);
  const [, setSponsorLoading] = useState(false);
  const topicsSinceSponsorCardRef = useRef(0);
  const sponsorCardsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string }>());
  const sponsorResultsByTopicId = useRef(new Map<string, { campaigns: SponsorFeedCampaign[]; sessionId: string | null }>());
  const sponsorRequestsByTopicId = useRef(new Map<string, Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }>>());

  const sponsorSessionUserId = useRef(userId);
  const sponsorLoadingRef = useRef(false);
  const sponsorRequestVersion = useRef(0);
  const sponsorDueByTopicId = useRef(new Set<string>());
  const sponsorDirectionByTopicId = useRef(new Map<string, FeedEntryDirection>());
  const [activeTopCommentIndex, setActiveTopCommentIndex] = useState(0);
  const [topCommentIndices, setTopCommentIndices] = useState<Record<string, number>>({});
  const [feedProgress, setFeedProgress] = useState({ current: 0, total: 5 });
  const updateFeedProgress = useCallback((current: number, total: number) => {
    setFeedProgress({ current, total });
  }, []);
  const activeInterstitialTopicIdRef = useRef<string | null>(null);
  const activateInterstitialTopic = (topicId: string | null) => {
    activeInterstitialTopicIdRef.current = topicId;
    setActiveTopCommentIndex(
      topicId ? topCommentIndices[topicId] ?? topCommentIndexByTopicId.current.get(topicId) ?? 0 : 0
    );
  };
  const [activeFeedEntryKey, setActiveFeedEntryKeyState] = useState<string | null>(null);
  const [feedEntryMap, setFeedEntryMap] = useState<FeedEntryMap | null>(null);
  const feedCardRendererContextRef = useRef<FeedCardRendererContext | null>(null);
  const feedCardRenderersRef = useRef<ReturnType<typeof createFeedCardRegistry>>([]);
  const activeFeedEntryKeyRef = useRef<string | null>(null);
  const setActiveFeedEntryKey = useCallback((key: string | null) => {
    activeFeedEntryKeyRef.current = key;
    setActiveFeedEntryKeyState(key);
  }, []);

  const [topicIndex, setTopicIndex] = useState(personalized || generalRanked ? 0 : Math.floor(topics.length / 2));
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
    // Never reuse an anonymous sponsor session token across sign-in/account changes.
    ephemeralSponsorSessionId = null;
    seenTopCommentUserId.current = userId;
    topCommentCadenceUserId.current = userId;
    seenTopCommentIds.current.clear();
    topCommentCardsByTopicId.current.clear();
    topCommentIndexByTopicId.current.clear();
    setTopCommentIndices({});
    setActiveTopCommentIndex(0);
    processedTopicBoundariesByTopicId.current.clear();
    feedEntryMapRef.current = null;
    setFeedEntryMap(null);
    activeInterstitialTopicIdRef.current = null;
    sponsorCardsByTopicId.current.clear();
    sponsorResultsByTopicId.current.clear();
    sponsorRequestsByTopicId.current.clear();
    sponsorDueByTopicId.current.clear();
    sponsorDirectionByTopicId.current.clear();
    sponsorRequestVersion.current += 1;
    sponsorLoadingRef.current = false;
    setActiveFeedEntryKey(null);
    setActiveTopCommentIndex(0);
    setSponsorLoading(false);
    topicsSinceSponsorCardRef.current = 0;
    topicsSinceTopCommentCardRef.current = 0;
  }, [userId, setActiveFeedEntryKey]);

  const loadSponsorCampaigns = useCallback(
    async (topic: Topic): Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }> => {

      // Anonymous placements share an in-memory session token for frequency caps;
      // signed-in placements get unique IDs so separate card views are not deduplicated.
      const measurementEnabled = hasAnalyticsConsent('sponsorMeasurement', userId);
      const sessionId = measurementEnabled
        ? (userId ? createSponsorPlacementId() : createSponsorSessionId())
        : null;
      if (measurementEnabled && !sessionId) return { campaigns: [], sessionId: null, retryable: true };

      try {
        let accessToken = userId && getSponsorAccessToken ? await getSponsorAccessToken() : null;
        if (userId && !accessToken) {
          if (!getSponsorAccessToken) return { campaigns: [], sessionId: null, retryable: true };
          // Auth state can briefly lag the feed's signed-in state during
          // session hydration. Retry once before treating the request as transient.
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          accessToken = await getSponsorAccessToken();
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (userId && !accessToken) {
          console.warn('Sponsor campaign request deferred because no access token is available yet.');
          return { campaigns: [], sessionId: null, retryable: true };
        }
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
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
            setTopCommentIndices({});
            setActiveTopCommentIndex(0);
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
  }, [topCommentsEndpoint, setActiveFeedEntryKey]);

  const getSponsorCampaignResult = useCallback(
    (topic: Topic): Promise<{ campaigns: SponsorFeedCampaign[]; sessionId: string | null; retryable?: boolean }> => {
      const cached = sponsorResultsByTopicId.current.get(topic.id);
      if (cached) return Promise.resolve(cached);

      const inFlight = sponsorRequestsByTopicId.current.get(topic.id);
      if (inFlight) return inFlight;

      const requestedUserId = userId;
      const requestedMeasurementEnabled = hasAnalyticsConsent('sponsorMeasurement', requestedUserId);
      const request = loadSponsorCampaigns(topic)
        .then((result) => {
          // A consent change while the request is in flight invalidates its
          // visitor/session token. Keep the sponsor placement, but never cache
          // or expose the token after the user withdraws measurement.
          if (hasAnalyticsConsent('sponsorMeasurement', requestedUserId) !== requestedMeasurementEnabled) {
            return { ...result, sessionId: null };
          }
          // Cache both successful and empty results. A missing placement is a
          // stable decision for this topic during the current feed session.
          if (sponsorSessionUserId.current === requestedUserId && !result.retryable) {
            // Cache a successful placement or a successful empty eligibility
            // result. Never pin a transient auth/network/server failure as the
            // permanent no-campaign decision for this topic in this session.
            sponsorResultsByTopicId.current.set(topic.id, result);
            if (result.campaigns.length > 0) {
              sponsorCardsByTopicId.current.set(topic.id, {
                campaigns: result.campaigns,
                sessionId: result.sessionId ?? '',
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

  useEffect(() => {
    const handleConsentChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if ((detail?.userId ?? null) !== (userId ?? null)) return;
      if (hasAnalyticsConsent('sponsorMeasurement', userId)) return;

      // Remove any token created before withdrawal from both the feed cache and
      // the currently mounted card. Campaign delivery remains in the queue.
      ephemeralSponsorSessionId = null;
      sponsorRequestVersion.current += 1;
      sponsorResultsByTopicId.current.clear();
      sponsorCardsByTopicId.current.clear();
      sponsorRequestsByTopicId.current.clear();

      const currentMap = feedEntryMapRef.current;
      if (!currentMap) return;
      const boundaries = currentMap.boundaries.map((boundary) => ({
        ...boundary,
        entries: boundary.entries.map((entry) =>
          entry.type === 'sponsor' ? { ...entry, sessionId: '' } : entry
        ),
      }));
      const byTopicId = new Map(boundaries.map((boundary) => [boundary.topicId, boundary] as const));
      const nextMap = { ...currentMap, boundaries, byTopicId };
      feedEntryMapRef.current = nextMap;
      setFeedEntryMap(nextMap);
    };
    window.addEventListener(analyticsConsentChangeEvent, handleConsentChange);
    return () => window.removeEventListener(analyticsConsentChangeEvent, handleConsentChange);
  }, [setFeedEntryMap, userId]);

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
      if (result.campaigns.length > 0) {
        currentSponsor.campaigns = result.campaigns;
        currentSponsor.sessionId = result.sessionId ?? '';
        currentSponsor.status = 'ready';
      } else {
        currentBoundary.entries = currentBoundary.entries.filter((item) => item.type !== 'sponsor');
      }
      // Publish the resolved placement immutably. The ref is used by the
      // cursor, while React state drives the visible card renderer.
      const currentMap = feedEntryMapRef.current;
      if (currentMap) {
        const nextMap = {
          ...currentMap,
          boundaries: [...currentMap.boundaries],
          byTopicId: new Map(currentMap.byTopicId),
        };
        nextMap.byTopicId.set(topicId, currentBoundary);
        feedEntryMapRef.current = nextMap;
        setFeedEntryMap(nextMap);
      }
    });
  }, [getSponsorCampaignResult, userId]);

  // Build the ordered topic/comment/sponsor map ahead of navigation. The
  // original analytics-ranked topic array remains the source of truth; each
  // topic boundary owns its interstitial entries in this single map.
  useEffect(() => {
    if (feedTopics.length === 0) {
      feedEntryMapRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeedEntryMap(null);
      return;
    }

    const previousMap = feedEntryMapRef.current;
    const commentsById = new Map(
      topComments.map((comment) => [comment.comment_id, comment] as const)
    );
    const topicsById = new Map(feedTopics.map((topic) => [topic.id, topic] as const));

    // Keep every already-assigned boundary for the lifetime of this feed
    // session. Refreshes may update comment content or remove deleted comments,
    // but they must not move a returning comment/sponsor card to another topic.
    const preservedBoundaries = previousMap
      ? previousMap.boundaries.flatMap((boundary) => {
          const currentTopic = topicsById.get(boundary.topicId);
          if (!currentTopic) return [];
          return [reconcileFeedBoundary(
            boundary,
            currentTopic,
            commentsById,
            sponsorResultsByTopicId.current.get(boundary.topicId)
          )];
        })
      : [];
    const preservedTopicIds = new Set(preservedBoundaries.map((boundary) => boundary.topicId));
    const reservedCommentIds = collectReservedCommentIds(
      preservedBoundaries,
      seenTopCommentIds.current
    );
    const unseenComments = getUnseenTopFeedComments(topComments, reservedCommentIds);
    const reservedCommentIdsForMap = new Set(reservedCommentIds);
    if (unseenComments.length <= 10 && topCommentsNextOffsetRef.current !== null) {
      void loadMoreTopComments();
    }

    // If comments arrive after the first topic map was built, fill only due
    // boundaries the reader has not reached yet. Existing comment assignments
    // are never moved and already-passed boundaries are left untouched.
    const currentTopicPosition = feedTopics.findIndex((topic) => topic.id === currentTopicId.current);
    let nextCommentIndex = 0;
    const hydratedBoundaries = preservedBoundaries.map((boundary) => {
      const hasCommentCard = boundary.entries.some((entry) => entry.type === 'top-comments');
      const boundaryPosition = feedTopics.findIndex((topic) => topic.id === boundary.topicId);
      if (
        hasCommentCard ||
        boundaryPosition <= currentTopicPosition ||
        boundary.commentCadenceAfter !== 0 ||
        nextCommentIndex >= unseenComments.length
      ) return boundary;
      const comments = unseenComments.slice(nextCommentIndex, nextCommentIndex + 5);
      if (comments.length === 0) return boundary;
      nextCommentIndex += comments.length;
      for (const comment of comments) reservedCommentIdsForMap.add(comment.comment_id);
      const commentEntry: FeedEntry = {
        type: 'top-comments',
        topicId: boundary.topicId,
        comments,
      };
      const sponsorIndex = boundary.entries.findIndex((entry) => entry.type === 'sponsor');
      const insertIndex = sponsorIndex >= 0 ? sponsorIndex : boundary.entries.length;
      return {
        ...boundary,
        entries: [
          ...boundary.entries.slice(0, insertIndex),
          commentEntry,
          ...boundary.entries.slice(insertIndex),
        ],
      };
    });
    const remainingComments = unseenComments.slice(nextCommentIndex);

    // Only topics appended since the last map build receive new placements.
    // Existing boundaries and their cadence snapshots remain immutable.
    const newTopics = feedTopics.filter((topic) => !preservedTopicIds.has(topic.id));
    const planned = buildFeedEntryMap({
      topics: newTopics,
      comments: remainingComments,
      seenCommentIds: reservedCommentIdsForMap,
      userId,
      commentCadence: previousMap?.commentCadence ?? topicsSinceTopCommentCardRef.current,
      sponsorCadence: previousMap?.sponsorCadence ?? topicsSinceSponsorCardRef.current,
      sponsorResults: sponsorResultsByTopicId.current,
    });
    const boundaries = [...hydratedBoundaries, ...planned.boundaries];
    const byTopicId = new Map(boundaries.map((boundary) => [boundary.topicId, boundary] as const));
    const nextFeedEntryMap: FeedEntryMap = {
      ...planned,
      boundaries,
      byTopicId,
      reservedCommentIds: planned.reservedCommentIds,
    };
    feedEntryMapRef.current = nextFeedEntryMap;
    setFeedEntryMap(nextFeedEntryMap);
    for (const boundary of boundaries) {
      const sponsorEntry = boundary.entries.find((entry) => entry.type === 'sponsor');
      if (sponsorEntry && sponsorEntry.type === 'sponsor' && sponsorEntry.status !== 'empty') {
        sponsorDueByTopicId.current.add(boundary.topicId);
      } else {
        sponsorDueByTopicId.current.delete(boundary.topicId);
      }
    }

    // Resolve only the next sponsor slot. Fetching every future campaign
    // would consume per-user delivery caps for cards the user may never reach.
    const firstSponsor = boundaries
      .flatMap((boundary) => boundary.entries)
      .find((entry) => entry.type === 'sponsor');
    if (firstSponsor && firstSponsor.type === 'sponsor' && firstSponsor.status === 'pending') {
      prefetchMappedSponsor(firstSponsor.topicId);
    }
  }, [feedTopics, topComments, userId, getSponsorCampaignResult, prefetchMappedSponsor, loadMoreTopComments]);

  // Keep a cursor for every active feed entry, including ordinary topics.
  useEffect(() => {
    if (activeFeedEntryKey && !activeFeedEntryKey.startsWith('topic:')) return;
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
      activeFeedEntryKey.startsWith('topic:') ||
      !activeInterstitialTopicIdRef.current
    ) return;
    const entries = feedEntryMap ? flattenFeedEntryMap(feedEntryMap) : [];
    const cursor = reconcileFeedEntryCursor(
      entries,
      activeFeedEntryKey,
      activeInterstitialTopicIdRef.current
    );
    if (cursor?.key === activeFeedEntryKey) return;
    activeFeedEntryKeyRef.current = null;
    setActiveFeedEntryKeyState(null);
    if (cursor?.key.startsWith('topic:')) {
      const topicId = cursor.key.slice('topic:'.length);
      const index = feedTopics.findIndex((topic) => topic.id === topicId);
      if (index >= 0) {
          setTopicIndex(index);
      }
    }
    activeInterstitialTopicIdRef.current = null;
    setActiveTopCommentIndex(0);
  }, [activeFeedEntryKey, feedEntryMap, feedTopics, topComments, userId]);

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    // Personalised and general-ranked modes preserve server ordering. The
    // legacy catalogue shuffle remains only for non-ranked fallback feeds.
    const orderedTopics = personalized || generalRanked ? topics : shuffle(topics);
    const sourceChanged = previousPersonalizedRef.current !== personalized;

    if (preservePositionOnUpdate && feedInitializedRef.current) {
      // Native catalogue/background updates must not replace the active
      // session snapshot or discard pages already visited. Append only new IDs.
      const nextFeedTopics = appendUniqueFeedTopics(feedTopicsRef.current, orderedTopics);
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
    setFeedTopics(orderedTopics);
    feedTopicsRef.current = orderedTopics;
    setTopicIndex(personalized || generalRanked ? 0 : Math.floor(orderedTopics.length / 2));
    setNextCursor(initialCursor);
    setLoadingMore(false);
    setLoadError('');
    feedInitializedRef.current = true;
    previousPersonalizedRef.current = personalized;
  }, [topics, initialCursor, personalized, generalRanked, preservePositionOnUpdate]);

  const loadMoreTopics = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    const generation = generationRef.current;
    setLoadingMore(true);
    setLoadError('');

    try {
      const result = await loadPage(nextCursor);
      if (generation !== generationRef.current) return;
      const newTopics = personalized || generalRanked ? result.topics : shuffle(result.topics);
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
  }, [nextCursor, personalized, generalRanked, loadPage]);

  // ----------------------------------
  // Navigation
  // ----------------------------------

  // Modulo arithmetic wraps the finite catalogue into a circular feed.
  const advanceToNextTopic = () => {
    setActiveFeedEntryKey(null);
    activateInterstitialTopic(null);
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
    setTopicIndex((prev) => (prev + 1) % feedTopics.length);
  };

  const markTopCommentViewed = useCallback(
    (commentId: number) => {
      if (seenTopCommentUserId.current !== userId) {
        seenTopCommentUserId.current = userId;
        seenTopCommentIds.current.clear();
        topCommentCardsByTopicId.current.clear();
        topCommentIndexByTopicId.current.clear();
        setTopCommentIndices({});
        setActiveTopCommentIndex(0);
        processedTopicBoundariesByTopicId.current.clear();
        sponsorDueByTopicId.current.clear();
      }
      seenTopCommentIds.current.add(commentId);
    },
    [userId]
  );

  const activateFeedEntry = async (
    entry: FeedEntry,
    direction: FeedEntryDirection,
    entries: readonly FeedEntry[]
  ) => {
    setActiveFeedEntryKey(getFeedEntryKey(entry));

    if (entry.type === 'topic') {
      activateInterstitialTopic(null);
      const index = feedTopics.findIndex((topic) => topic.id === entry.topicId);
      if (index >= 0) setTopicIndex(index);
      return;
    }

    activateInterstitialTopic(entry.topicId);
    if (entry.type === 'top-comments') {
      setFeedProgress({
        current: topCommentIndexByTopicId.current.get(entry.topicId) ?? 0,
        total: entry.comments.length,
      });
    } else {
      setFeedProgress({ current: 0, total: 1 });
    }
    const rendererContext = feedCardRendererContextRef.current;
    if (!rendererContext) return;
    await invokeRegisteredFeedEntryLifecycle(
      entry,
      'enter',
      direction,
      entries,
      feedCardRenderersRef.current,
      rendererContext
    );
  };

  const loadSponsorEntry = async (
    entry: Extract<FeedEntry, { type: 'sponsor' }>,
    direction: FeedEntryDirection,
    entries: readonly FeedEntryLike[]
  ) => {
    const sponsorTopic = feedTopics.find((topic) => topic.id === entry.topicId);
    const entryKey = getFeedEntryKey(entry);
    const skipEntry = async () => {
      const adjacent = getAdjacentFeedEntry(entries, entryKey, direction);
      if (adjacent) {
        await activateFeedEntry(adjacent.entry as FeedEntry, direction, entries as readonly FeedEntry[]);
      } else if (direction === 'next') {
        setActiveFeedEntryKey(null);
        advanceToNextTopic();
      } else {
        setActiveFeedEntryKey(null);
        const anchorIndex = feedTopics.findIndex((topic) => topic.id === entry.topicId);
        const previousIndex = anchorIndex >= 0
          ? (anchorIndex - 1 + feedTopics.length) % feedTopics.length
          : Math.max(0, feedTopics.length - 1);
        setTopicIndex(previousIndex);
        activateInterstitialTopic(null);
      }
    };

    if (!sponsorTopic) {
      await skipEntry();
      return;
    }

    sponsorLoadingRef.current = true;
    sponsorDirectionByTopicId.current.set(entry.topicId, direction);
    entry.status = 'pending';
    setSponsorLoading(true);
    const requestedUserId = userId;
    const requestVersion = ++sponsorRequestVersion.current;
    try {
      let result = await getSponsorCampaignResult(sponsorTopic);
      if (result.retryable) {
        // A token refresh/network race must not silently consume the sponsor
        // slot. Re-attempt once while the loading card remains active.
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        result = await getSponsorCampaignResult(sponsorTopic);
      }
      if (
        sponsorRequestVersion.current !== requestVersion ||
        sponsorSessionUserId.current !== requestedUserId
      ) return;

      if (result.campaigns.length > 0) {
        entry.campaigns = result.campaigns;
        entry.sessionId = result.sessionId ?? '';
        entry.status = 'ready';
        sponsorCardsByTopicId.current.set(entry.topicId, {
          campaigns: result.campaigns,
          sessionId: result.sessionId ?? '',
        });
        sponsorResultsByTopicId.current.set(entry.topicId, result);
        sponsorDueByTopicId.current.delete(entry.topicId);
        setSponsorLoading(false);
        return;
      }

      if (result.retryable) {
        // Keep the placement in the feed and expose an explicit retry action.
        // Only a confirmed empty eligibility result is allowed to remove it.
        entry.status = 'error';
        return;
      }

      entry.status = 'empty';
      sponsorDueByTopicId.current.delete(entry.topicId);
      const boundary = feedEntryMapRef.current?.byTopicId.get(entry.topicId);
      if (boundary) {
        boundary.entries = boundary.entries.filter((candidate) => candidate.type !== 'sponsor');
      }
      await skipEntry();
    } finally {
      if (sponsorRequestVersion.current === requestVersion) {
        sponsorLoadingRef.current = false;
        setSponsorLoading(false);
      }
    }
  };

  const cancelSponsorRequest = () => {
    if (!sponsorLoadingRef.current) return;
    sponsorRequestVersion.current += 1;
    sponsorLoadingRef.current = false;
    setSponsorLoading(false);
  };

  const navigateFeedEntry = async (direction: 'next' | 'previous') => {
    if (!feedEntryMapRef.current) return;
    const entries = flattenFeedEntryMap(feedEntryMapRef.current);
    const currentTopic = feedTopics[topicIndex];
    const currentKey = activeFeedEntryKeyRef.current ?? (
      currentTopic
        ? getFeedEntryKey({ type: 'topic', topicId: currentTopic.id })
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

    const rendererContext = feedCardRendererContextRef.current;
    if (currentEntry && currentEntry.type !== 'topic' && rendererContext) {
      await invokeRegisteredFeedEntryLifecycle(
        currentEntry,
        'exit',
        direction,
        entries,
        feedCardRenderersRef.current,
        rendererContext
      );
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

  const flattenedEntries = feedEntryMap ? flattenFeedEntryMap(feedEntryMap) : [];
  const activeMappedEntry = activeFeedEntryKey
    ? flattenedEntries.find((entry) => getFeedEntryKey(entry) === activeFeedEntryKey) ?? null
    : null;
  const activeFeedCardEntry: FeedEntry | null =
    activeMappedEntry && activeMappedEntry.type !== 'topic'
      ? activeMappedEntry
      : null;
  const currentTopicKey = feedTopics[topicIndex]
    ? `topic:${feedTopics[topicIndex].id}`
    : '';
  const currentEntryKey = activeMappedEntry
    ? getFeedEntryKey(activeMappedEntry)
    : currentTopicKey;
  const nextFeedEntry = currentEntryKey
    ? getAdjacentFeedEntry(flattenedEntries, currentEntryKey, 'next')?.entry ?? null
    : null;
  const previousFeedEntry = currentEntryKey
    ? getAdjacentFeedEntry(flattenedEntries, currentEntryKey, 'previous')?.entry ?? null
    : null;

  const baseFeedCardContext: FeedCardRendererContext = {
    userId,
    sponsorApiBaseUrl: effectiveSponsorApiBaseUrl,
    getSponsorAccessToken,
    activeTopCommentIndex,
    onProgressChange: updateFeedProgress,
    onTopCommentIndexChange: (topicId: string, index: number) => {
      setActiveTopCommentIndex(index);
      setTopCommentIndices((current) => ({ ...current, [topicId]: index }));
      topCommentIndexByTopicId.current.set(topicId, index);
    },
    onCommentViewed: markTopCommentViewed,
    onOpenComment: openTopComment,
    navigateNext: () => nextTopic(),
    navigatePrevious: () => previousTopic(),
    activateInterstitialTopic,
    markCommentSeen: (commentId) => seenTopCommentIds.current.add(commentId),
    cacheCommentGroup: (topicId, comments) => topCommentCardsByTopicId.current.set(topicId, comments),
    getTopCommentIndex: (topicId) => topCommentIndexByTopicId.current.get(topicId) ?? 0,
    loadSponsorEntry,
    retrySponsorEntry: (entry) => {
      const direction = sponsorDirectionByTopicId.current.get(entry.topicId) ?? 'next';
      const entries = feedEntryMapRef.current ? flattenFeedEntryMap(feedEntryMapRef.current) : [];
      void loadSponsorEntry(entry, direction, entries);
    },
    cancelSponsorRequest,
  };

  const renderFeedEntryPreview = (entry: FeedEntry | null): ReactNode | undefined => {
    if (!entry) return undefined;
    if (entry.type === 'topic') {
      const topic = feedTopics.find((item) => item.id === entry.topicId);
      return topic
        ? <TopicCard type="question" title="Question" content={topic.question} />
        : undefined;
    }

    const previewContext: FeedCardRendererContext = {
      ...baseFeedCardContext,
      previewMode: true,
      activeTopCommentIndex: entry.type === 'top-comments'
        ? topCommentIndices[entry.topicId] ?? 0
        : 0,
      nextEntryPreview: undefined,
      previousEntryPreview: undefined,
    };
    // The registry stores deferred callbacks; refs are read only when users interact with the preview's active counterpart.
    const previewRegistry = createFeedCardRegistry(previewContext);
    return renderRegisteredFeedEntry(entry, previewRegistry, previewContext);
  };

  const nextEntryPreview = renderFeedEntryPreview(nextFeedEntry); // eslint-disable-line react-hooks/refs
  const previousEntryPreview = renderFeedEntryPreview(previousFeedEntry); // eslint-disable-line react-hooks/refs
  const topicCard = (
    <Viewer
      topics={feedTopics}
      topicIndex={topicIndex}
      initialUserId={userId}
      active={!activeFeedCardEntry}
      onNextTopic={nextTopic}
      onPreviousTopic={previousTopic}
      onProgressChange={updateFeedProgress}
      nextEntryPreview={nextEntryPreview}
      previousEntryPreview={previousEntryPreview}
    />
  );
  const feedCardRendererContext: FeedCardRendererContext = {
    ...baseFeedCardContext,
    topicCard,
    previewMode: false,
    nextEntryPreview,
    previousEntryPreview,
  };
  // The registry stores deferred callbacks; refs are read only when users interact with the rendered card.
  const feedCardRenderers = createFeedCardRegistry(feedCardRendererContext); // eslint-disable-line react-hooks/refs
  useLayoutEffect(() => {
    feedCardRendererContextRef.current = feedCardRendererContext;
    feedCardRenderersRef.current = feedCardRenderers;
  });

  // Resolve every active entry—including topics—through the same registry.
  const renderedActiveEntry = activeMappedEntry
    ? renderRegisteredFeedEntry(activeMappedEntry, feedCardRenderers, feedCardRendererContext) // eslint-disable-line react-hooks/refs
    : topicCard;

  // ----------------------------------
  // Loading
  // ----------------------------------

  if (!feedTopics.length) {
    return null;
  }

  return (
    <>
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
      <FeedRenderer
        progress={<FeedProgress current={feedProgress.current} total={feedProgress.total} />}
        entryCard={renderedActiveEntry}
      />
    </>
  );
}
