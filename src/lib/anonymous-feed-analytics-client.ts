'use client';

import { siteConfig } from '@/lib/constants';

type AnonymousEntityType = 'topic' | 'comment';
type AnonymousEventType = 'impression' | 'viewable_impression' | 'active_duration' | 'skip' | 'completion' | 'open';

type AnonymousEvent = {
  eventId: string;
  entityType: AnonymousEntityType;
  entityId: string;
  eventType: AnonymousEventType;
  durationMs?: number;
};

const queueStorageKey = 'cathoscroll.anonymous-feed-events.v1';
const queueLimit = 2000;
const recentEventKeys = new Map<string, number>();
const pendingEvents: AnonymousEvent[] = [];
let hydrated = false;
let flushPromise: Promise<void> | null = null;
let listenersInstalled = false;

function uuid(): string | null {
  try {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
  } catch {
    return null;
  }
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

function isAnonymousEvent(value: unknown): value is AnonymousEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.eventId)) return false;
  if (event.entityType !== 'topic' && event.entityType !== 'comment') return false;
  if (typeof event.entityId !== 'string' || event.entityId.length < 1 || event.entityId.length > 160) return false;
  if (!['impression', 'viewable_impression', 'active_duration', 'skip', 'completion', 'open'].includes(String(event.eventType))) return false;
  if (event.eventType === 'active_duration') {
    return typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) &&
      event.durationMs >= 0 && event.durationMs <= 60000;
  }
  return event.durationMs === undefined;
}

function persistQueue(): void {
  if (typeof window === 'undefined') return;
  try {
    if (pendingEvents.length === 0) {
      window.localStorage.removeItem(queueStorageKey);
    } else {
      window.localStorage.setItem(queueStorageKey, JSON.stringify(pendingEvents.slice(-queueLimit)));
    }
  } catch {
    // Storage can be unavailable or full; the in-memory queue remains usable for this process.
  }
}

function hydrateQueue(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const stored = window.localStorage.getItem(queueStorageKey);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(queueStorageKey);
      return;
    }
    for (const value of parsed.slice(-queueLimit)) {
      if (isAnonymousEvent(value)) pendingEvents.push(value);
    }
    persistQueue();
  } catch {
    try {
      window.localStorage.removeItem(queueStorageKey);
    } catch {
      // Ignore inaccessible or malformed local storage.
    }
  }
}

export async function flushAnonymousFeedAnalyticsQueue(): Promise<void> {
  if (typeof window === 'undefined') return;
  hydrateQueue();
  if (!navigator.onLine || pendingEvents.length === 0 || flushPromise) return;

  const batch = pendingEvents.slice(0, 40);
  let shouldContinue = false;
  flushPromise = (async () => {
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
        const completed = new Set(batch.map((event) => event.eventId));
        for (let index = pendingEvents.length - 1; index >= 0; index -= 1) {
          if (completed.has(pendingEvents[index].eventId)) pendingEvents.splice(index, 1);
        }
        persistQueue();
      }
    } catch {
      // Keep the batch on disk for retry after reconnect or the next app launch.
    }
  })().finally(() => {
    flushPromise = null;
    if (shouldContinue && pendingEvents.length > 0 && navigator.onLine) {
      void flushAnonymousFeedAnalyticsQueue();
    }
  });

  await flushPromise;
}

export function installAnonymousFeedAnalyticsSync(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  hydrateQueue();
  if (!listenersInstalled) {
    listenersInstalled = true;
    window.addEventListener('online', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pageshow', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pagehide', () => void flushAnonymousFeedAnalyticsQueue());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void flushAnonymousFeedAnalyticsQueue();
      else void flushAnonymousFeedAnalyticsQueue();
    });
  }
  void flushAnonymousFeedAnalyticsQueue();
  return () => undefined;
}

export function recordAnonymousFeedEvent(
  entityType: AnonymousEntityType,
  entityId: string | number,
  eventType: AnonymousEventType,
  durationMs = 0,
): void {
  if (typeof window === 'undefined') return;
  hydrateQueue();
  const eventId = uuid();
  const id = String(entityId);
  if (!eventId || !id || id.length > 160) return;

  const now = Date.now();
  const dedupeKey = `${entityType}:${id}:${eventType}`;
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

  const event: AnonymousEvent = {
    eventId,
    entityType,
    entityId: id,
    eventType,
    ...(eventType === 'active_duration'
      ? { durationMs: Math.max(0, Math.min(60000, Math.round(durationMs))) }
      : {}),
  };
  pendingEvents.push(event);
  if (pendingEvents.length > queueLimit) pendingEvents.splice(0, pendingEvents.length - queueLimit);
  persistQueue();
  installAnonymousFeedAnalyticsSync();
  void flushAnonymousFeedAnalyticsQueue();
}
