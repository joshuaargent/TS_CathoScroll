'use client';
import { siteConfig } from '@/lib/constants';

export type AnonymousEntityType = 'topic' | 'comment';
export type AnonymousEventType = 'impression' | 'viewable_impression' | 'active_duration' | 'skip' | 'completion' | 'open';
export type AnonymousFeedAnalyticsEvent = {
  eventId: string;
  entityType: AnonymousEntityType;
  entityId: string;
  eventType: AnonymousEventType;
  durationMs?: number;
};
export interface AnonymousFeedAnalyticsOutbox {
  initialize(): Promise<void>;
  enqueue(event: AnonymousFeedAnalyticsEvent): Promise<void>;
  pending(limit: number): Promise<AnonymousFeedAnalyticsEvent[]>;
  acknowledge(eventIds: string[]): Promise<void>;
}

const queueLimit = 2000;
const recentEventKeys = new Map<string, number>();
const pendingEvents: AnonymousFeedAnalyticsEvent[] = [];
const volatileEventIds = new Set<string>();
let flushPromise: Promise<void> | null = null;
let listenersInstalled = false;
let persistentOutbox: AnonymousFeedAnalyticsOutbox | null = null;
let outboxReady: Promise<void> | null = null;

function uuid(): string | null {
  try {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
  } catch {
    return null;
  }
}

function removePendingEvents(eventIds: string[]): void {
  const completed = new Set(eventIds);
  for (let index = pendingEvents.length - 1; index >= 0; index -= 1) {
    if (completed.has(pendingEvents[index].eventId)) pendingEvents.splice(index, 1);
  }
  for (const eventId of completed) volatileEventIds.delete(eventId);
}

function getEndpoint(): string {
  const nativeOrigin = typeof window !== 'undefined' && (
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'capacitor-electron:' ||
    window.location.origin === 'http://localhost' ||
    window.location.origin === 'https://localhost'
  ) ? siteConfig.url : undefined;
  return nativeOrigin
    ? new URL('/api/analytics/anonymous-events', nativeOrigin).toString()
    : '/api/analytics/anonymous-events';
}

export async function configureAnonymousFeedAnalyticsOutbox(
  outbox: AnonymousFeedAnalyticsOutbox
): Promise<void> {
  await outbox.initialize();
  persistentOutbox = outbox;
  outboxReady = Promise.resolve();
  for (const event of pendingEvents.slice()) {
    try {
      await outbox.enqueue(event);
      removePendingEvents([event.eventId]);
    } catch {
      volatileEventIds.add(event.eventId);
    }
  }
  void flushAnonymousFeedAnalyticsQueue();
}

export async function flushAnonymousFeedAnalyticsQueue(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator === 'undefined' || !navigator.onLine || flushPromise) return;
  if (!persistentOutbox && pendingEvents.length === 0) return;

  let shouldContinue = false;
  flushPromise = (async () => {
    let batch: AnonymousFeedAnalyticsEvent[] = [];
    try {
      if (persistentOutbox) {
        await outboxReady;
        batch = await persistentOutbox.pending(40);
        if (batch.length < 40 && volatileEventIds.size > 0) {
          const volatile = pendingEvents.filter((event) => volatileEventIds.has(event.eventId));
          batch.push(...volatile.slice(0, 40 - batch.length));
        }
      } else {
        batch = pendingEvents.slice(0, 40);
      }
    } catch {
      batch = pendingEvents.filter((event) => volatileEventIds.has(event.eventId)).slice(0, 40);
    }
    if (batch.length === 0) return;

    try {
      const response = await fetch(getEndpoint(), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        shouldContinue = true;
        const completed = batch.map((event) => event.eventId);
        if (persistentOutbox) {
          const durableIds = completed.filter((eventId) => !volatileEventIds.has(eventId));
          try {
            await persistentOutbox.acknowledge(durableIds);
          } catch {
            return;
          }
        }
        removePendingEvents(completed);
      }
    } catch {
      // Keep failed batches for retry after reconnect or app restart.
    }
  })().finally(() => {
    flushPromise = null;
    if (shouldContinue && (
      pendingEvents.length > 0 ||
      (persistentOutbox !== null && typeof navigator !== 'undefined' && navigator.onLine)
    )) {
      void flushAnonymousFeedAnalyticsQueue();
    }
  });

  await flushPromise;
}

export function installAnonymousFeedAnalyticsSync(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (!listenersInstalled) {
    listenersInstalled = true;
    window.addEventListener('online', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pageshow', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pagehide', () => void flushAnonymousFeedAnalyticsQueue());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => void flushAnonymousFeedAnalyticsQueue());
    }
  }
  if (!persistentOutbox) void flushAnonymousFeedAnalyticsQueue();
  return () => undefined;
}

export function recordAnonymousFeedEvent(
  entityType: AnonymousEntityType,
  entityId: string | number,
  eventType: AnonymousEventType,
  durationMs = 0,
): void {
  if (typeof window === 'undefined') return;
  const eventId = uuid();
  const id = String(entityId);
  if (!eventId || !id || id.length > 160) return;

  const now = Date.now();
  const dedupeKey = entityType + ':' + id + ':' + eventType;
  if (eventType !== 'active_duration') {
    const previous = recentEventKeys.get(dedupeKey);
    if (previous !== undefined && now - previous < 1500) return;
    recentEventKeys.set(dedupeKey, now);
  }
  if (recentEventKeys.size > 500) {
    for (const [key, timestamp] of recentEventKeys) {
      if (now - timestamp > 60000) recentEventKeys.delete(key);
    }
  }

  const event: AnonymousFeedAnalyticsEvent = {
    eventId,
    entityType,
    entityId: id,
    eventType,
    ...(eventType === 'active_duration'
      ? { durationMs: Math.max(0, Math.min(60000, Math.round(durationMs))) }
      : {}),
  };
  pendingEvents.push(event);
  if (pendingEvents.length > queueLimit) {
    const removed = pendingEvents.splice(0, pendingEvents.length - queueLimit);
    for (const dropped of removed) volatileEventIds.delete(dropped.eventId);
  }
  installAnonymousFeedAnalyticsSync();

  if (persistentOutbox) {
    void (async () => {
      try {
        await outboxReady;
        await persistentOutbox?.enqueue(event);
        removePendingEvents([event.eventId]);
      } catch {
        volatileEventIds.add(event.eventId);
      }
      await flushAnonymousFeedAnalyticsQueue();
    })();
  } else {
    void flushAnonymousFeedAnalyticsQueue();
  }
}
