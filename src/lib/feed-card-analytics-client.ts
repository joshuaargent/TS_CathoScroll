'use client';

type FeedCardEventType = 'impression' | 'viewable_impression' | 'active_duration' | 'skip' | 'completion' | 'open';
type QueuedEvent = {
  event_id: string;
  session_id: string;
  event_type: FeedCardEventType;
  card_type: 'top-comment';
  card_id: string;
  duration_ms: number;
  metadata: Record<string, never>;
};

const pendingQueues = new Map<string, QueuedEvent[]>();
const queueLimit = 200;
type FeedCardAnalyticsTransport = { endpoint?: string; getAccessToken?: () => Promise<string | null>; retired?: boolean };
const transports = new Map<string, FeedCardAnalyticsTransport>();
const flushingUsers = new Set<string>();
const sessionIds = new Map<string, string>();

function uuid(): string | null {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return null;
  } catch { return null; }
}

function getSessionId(userId: string): string | null {
  let value = sessionIds.get(userId);
  if (!value) {
    value = uuid() ?? undefined;
    if (value) sessionIds.set(userId, value);
  }
  return value ?? null;
}

function readQueue(userId: string): QueuedEvent[] {
  return pendingQueues.get(userId) ?? [];
}

function writeQueue(userId: string, events: QueuedEvent[]) {
  if (events.length) pendingQueues.set(userId, events);
  else pendingQueues.delete(userId);
}

export function recordFeedCardAnalyticsEvent(
  userId: string | null,
  eventType: FeedCardEventType,
  commentId: number,
  durationMs = 0
) {
  if (!userId || !Number.isSafeInteger(commentId) || commentId < 1 || typeof window === 'undefined') return;
  const eventId = uuid();
  const currentSessionId = getSessionId(userId);
  if (!eventId || !currentSessionId) return;
  const queue = readQueue(userId);
  queue.push({
    event_id: eventId,
    session_id: currentSessionId,
    event_type: eventType,
    card_type: 'top-comment',
    card_id: String(commentId),
    duration_ms: Math.max(0, Math.min(300000, Math.round(durationMs))),
    metadata: {},
  });
  if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit);
  writeQueue(userId, queue);
  if (navigator.onLine) void flushFeedCardAnalytics(userId);
}

export async function flushFeedCardAnalytics(userId: string, keepalive = false) {
  if (typeof window === 'undefined' || !navigator.onLine || flushingUsers.has(userId)) return;
  flushingUsers.add(userId);
  try {
    for (;;) {
      const batch = readQueue(userId).slice(0, 50);
      if (!batch.length) break;
      const transport = transports.get(userId);
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (transport?.getAccessToken) {
        let accessToken: string | null;
        try { accessToken = await transport.getAccessToken(); } catch { break; }
        if (!accessToken) break;
        headers.set('Authorization', 'Bearer ' + accessToken);
      }
      let response: Response;
      try {
        response = await fetch(transport?.endpoint ?? '/api/analytics/feed-card-events', {
          method: 'POST',
          credentials: transport?.endpoint ? 'omit' : 'same-origin',
          cache: 'no-store',
          keepalive,
          headers,
          body: JSON.stringify({ events: batch }),
        });
      } catch { break; }
      if (!response.ok) break;
      const accepted = new Set(batch.map((event) => event.event_id));
      writeQueue(userId, readQueue(userId).filter((event) => !accepted.has(event.event_id)));
      if (keepalive) break;
    }
  } finally {
    flushingUsers.delete(userId);
    const transport = transports.get(userId);
    if (transport?.retired && readQueue(userId).length === 0) transports.delete(userId);
  }
}

export function installFeedCardAnalyticsListeners(
  userId: string,
  transport: FeedCardAnalyticsTransport = {}
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const installed: FeedCardAnalyticsTransport = { ...transport };
  transports.set(userId, installed);
  const flush = () => void flushFeedCardAnalytics(userId);
  const flushOnHide = () => {
    if (document.visibilityState === 'hidden') void flushFeedCardAnalytics(userId, true);
  };
  flush();
  window.addEventListener('online', flush);
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', flushOnHide);
  return () => {
    window.removeEventListener('online', flush);
    window.removeEventListener('pagehide', flushOnHide);
    document.removeEventListener('visibilitychange', flushOnHide);
    if (transports.get(userId) === installed) {
      installed.retired = true;
      void flushFeedCardAnalytics(userId, true);
    }
  };
}
