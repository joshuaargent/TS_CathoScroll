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
const storagePrefix = 'cathoscroll.feed-analytics.v1.';
const sessionId = createUuid();
const flushingUsers = new Set<string>();
type FeedAnalyticsTransport = {
  endpoint?: string;
  getAccessToken?: () => Promise<string | null>;
  retired?: boolean;
};
const transports = new Map<string, FeedAnalyticsTransport>();

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

function storageKey(userId: string): string {
  return storagePrefix + userId;
}

function readQueue(userId: string): QueuedFeedAnalyticsEvent[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedEvent);
  } catch {
    return [];
  }
}

function isQueuedEvent(value: unknown): value is QueuedFeedAnalyticsEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.event_id === 'string' &&
    typeof event.session_id === 'string' &&
    typeof event.entity_id === 'string' &&
    event.entity_type === 'topic' &&
    typeof event.event_type === 'string' &&
    [
      'impression',
      'viewable_impression',
      'active_duration',
      'skip',
      'swipe_depth',
      'completion',
      'return_visit',
    ].includes(event.event_type) &&
    Boolean(event.metadata) &&
    typeof event.metadata === 'object' &&
    !Array.isArray(event.metadata)
  );
}

function writeQueue(userId: string, events: QueuedFeedAnalyticsEvent[]): void {
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(storageKey(userId));
    } else {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(events));
    }
  } catch {
    // Analytics are best-effort and must never interfere with learning actions.
  }
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

  const queue = readQueue(userId);
  queue.push(event);
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
      transports.delete(userId);
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
  // Drain events left by a previous offline session as soon as the authenticated
  // transport is installed. Native WebViews can restart without an `online` event.
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
