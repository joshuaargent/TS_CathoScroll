'use client';

export type FeedAnalyticsEventType =
  | 'impression'
  | 'viewable_impression'
  | 'active_duration'
  | 'skip'
  | 'swipe_depth'
  | 'completion'
  | 'return_visit';

type FeedAnalyticsMetadata = {
  slide_index?: number;
  duration_ms?: number;
  source?: 'feed' | 'topic' | 'category' | 'search' | 'related' | 'direct';
  depth?: number;
  completion_percent?: number;
};

type QueuedFeedAnalyticsEvent = {
  event_id: string;
  session_id: string;
  event_type: FeedAnalyticsEventType;
  entity_type: 'topic';
  entity_id: string;
  metadata: FeedAnalyticsMetadata;
};

const batchLimit = 50;
const queueLimit = 200;
const pendingQueues = new Map<string, QueuedFeedAnalyticsEvent[]>();
const sessionId = createUuid();
const flushingUsers = new Set<string>();
type FeedAnalyticsTransport = {
  endpoint?: string;
  getAccessToken?: () => Promise<string | null>;
  retired?: boolean;
};
const transports = new Map<string, FeedAnalyticsTransport>();

// These session-scoped sets live outside React components so conditional
// rendering of interstitial cards cannot reset visit/completion attribution.
const visitedTopicsByUser = new Map<string, Set<string>>();
const completedTopicsByUser = new Map<string, Set<string>>();
const maxTrackedTopicsPerUser = 5000;
const recentTopicVisitAt = new Map<string, number>();
const duplicateVisitWindowMs = 100;

function rememberTopic(
  collection: Map<string, Set<string>>,
  userId: string,
  topicId: string
): boolean {
  let topics = collection.get(userId);
  if (!topics) {
    topics = new Set<string>();
    collection.set(userId, topics);
  }
  if (topics.has(topicId)) return false;
  topics.add(topicId);
  if (topics.size > maxTrackedTopicsPerUser) {
    const oldestTopicId = topics.values().next().value;
    if (oldestTopicId !== undefined) topics.delete(oldestTopicId);
  }
  return true;
}

export function recordFeedTopicVisit(userId: string | null, topicId: string): void {
  if (!userId || !topicId) return;
  const now = Date.now();
  const visitKey = userId + '\u0000' + topicId;
  const lastVisitAt = recentTopicVisitAt.get(visitKey);
  if (lastVisitAt !== undefined && now >= lastVisitAt && now - lastVisitAt < duplicateVisitWindowMs) {
    return;
  }
  recentTopicVisitAt.delete(visitKey);
  recentTopicVisitAt.set(visitKey, now);
  if (recentTopicVisitAt.size > maxTrackedTopicsPerUser * 10) {
    const oldestKey = recentTopicVisitAt.keys().next().value;
    if (oldestKey !== undefined) recentTopicVisitAt.delete(oldestKey);
  }
  const isReturnVisit = !rememberTopic(visitedTopicsByUser, userId, topicId);
  recordFeedAnalyticsEvent(userId, 'impression', topicId, { source: 'feed' });
  if (isReturnVisit) {
    recordFeedAnalyticsEvent(userId, 'return_visit', topicId, { source: 'feed' });
  }
}

export function recordFeedTopicCompletion(
  userId: string | null,
  topicId: string,
  slideIndex?: number
): void {
  if (!userId || !topicId || !rememberTopic(completedTopicsByUser, userId, topicId)) return;
  recordFeedAnalyticsEvent(userId, 'completion', topicId, {
    ...(slideIndex !== undefined ? { slide_index: slideIndex } : {}),
    completion_percent: 100,
  });
}


function createUuid(): string | null {
  if (typeof crypto === 'undefined') return null;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== 'function') return null;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function readQueue(userId: string): QueuedFeedAnalyticsEvent[] {
  return pendingQueues.get(userId) ?? [];
}

function writeQueue(userId: string, events: QueuedFeedAnalyticsEvent[]): void {
  if (events.length === 0) pendingQueues.delete(userId);
  else pendingQueues.set(userId, events);
}

export function recordFeedAnalyticsEvent(
  userId: string | null,
  eventType: FeedAnalyticsEventType,
  topicId: string,
  metadata: FeedAnalyticsMetadata = {}
): void {
  if (!userId || !sessionId || typeof window === 'undefined' || !topicId || topicId.length > 100) return;

  const eventId = createUuid();
  if (!eventId) return;

  const event: QueuedFeedAnalyticsEvent = {
    event_id: eventId,
    session_id: sessionId,
    event_type: eventType,
    entity_type: 'topic',
    entity_id: topicId,
    metadata,
  };

  // Keep the active-page queue bounded. Analytics are not written to browser
  // storage; unsent events are discarded when the page or app process ends.
  // If the queue fills, discard the oldest events rather than stopping capture.
  const queue = readQueue(userId);
  queue.push(event);
  if (queue.length > queueLimit) {
    queue.splice(0, queue.length - queueLimit);
  }
  writeQueue(userId, queue);

  if (navigator.onLine) void flushFeedAnalytics(userId);
}

export async function flushFeedAnalytics(userId: string, keepalive = false): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine || flushingUsers.has(userId)) return;

  flushingUsers.add(userId);
  try {
    for (;;) {
      const queue = readQueue(userId);
      if (queue.length === 0) break;

      const batch = queue.slice(0, batchLimit);
      let response: Response;
      const transport = transports.get(userId);
      const headers = new Headers({ 'Content-Type': 'application/json' });

      if (transport?.getAccessToken) {
        let accessToken: string | null;
        try {
          accessToken = await transport.getAccessToken();
        } catch {
          break;
        }
        if (!accessToken) break;
        headers.set('Authorization', 'Bearer ' + accessToken);
      }

      try {
        response = await fetch(transport?.endpoint ?? '/api/analytics/feed-events', {
          method: 'POST',
          credentials: transport?.endpoint ? 'omit' : 'same-origin',
          cache: 'no-store',
          keepalive,
          headers,
          body: JSON.stringify({ events: batch }),
        });
      } catch {
        break;
      }

      if (!response.ok) break;

      const acceptedIds = new Set(batch.map((event) => event.event_id));
      const latestQueue = readQueue(userId);
      writeQueue(
        userId,
        latestQueue.filter((event) => !acceptedIds.has(event.event_id))
      );

      if (keepalive) break;
    }
  } finally {
    flushingUsers.delete(userId);
    const transport = transports.get(userId);
    if (transport?.retired && readQueue(userId).length === 0) {
      // React may clean up this listener effect immediately before the topic
      // duration effect records its final event. Defer transport retirement
      // until the current cleanup stack has completed so that last event keeps
      // the native endpoint and bearer-token provider.
      queueMicrotask(() => {
        if (
          transports.get(userId) === transport &&
          readQueue(userId).length === 0 &&
          !flushingUsers.has(userId)
        ) {
          transports.delete(userId);
        }
      });
    }
  }
}

export function installFeedAnalyticsListeners(
  userId: string,
  transport: FeedAnalyticsTransport = {}
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const installedTransport: FeedAnalyticsTransport = { ...transport };
  transports.set(userId, installedTransport);
  // Flush any events queued in this active page as soon as the authenticated
  // transport is installed.
  const flush = () => void flushFeedAnalytics(userId);
  flush();
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      void flushFeedAnalytics(userId, true);
    }
  };

  window.addEventListener('online', flush);
  window.addEventListener('pagehide', handleVisibility);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    window.removeEventListener('online', flush);
    window.removeEventListener('pagehide', handleVisibility);
    document.removeEventListener('visibilitychange', handleVisibility);

    // The topic-duration effect also flushes during unmount. Retain the
    // authenticated transport through the current cleanup turn so its final
    // event cannot fall back to an unauthenticated relative endpoint.
    if (transports.get(userId) === installedTransport) {
      installedTransport.retired = true;
      Promise.resolve().then(() => {
        if (transports.get(userId) !== installedTransport) return;
        if (readQueue(userId).length === 0 && !flushingUsers.has(userId)) {
          transports.delete(userId);
        } else {
          void flushFeedAnalytics(userId);
        }
      });
    }
  };
}
