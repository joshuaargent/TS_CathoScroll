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

const recentEventKeys = new Map<string, number>();
const pendingEvents: { target: string; event: AnonymousEvent }[] = [];
let flushPromise: Promise<void> | null = null;
let listenersInstalled = false;

function uuid(): string | null {
  try {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
  } catch {
    return null;
  }
}

function getEndpoint(endpoint?: string): string {
  const nativeOrigin = typeof window !== 'undefined' && (
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'capacitor-electron:' ||
    window.location.origin === 'http://localhost' ||
    window.location.origin === 'https://localhost'
  ) ? siteConfig.url : undefined;
  return endpoint ?? (nativeOrigin
    ? new URL('/api/analytics/anonymous-events', nativeOrigin).toString()
    : '/api/analytics/anonymous-events');
}

async function flushAnonymousEvents(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine || pendingEvents.length === 0 || flushPromise) return;

  const target = pendingEvents[0].target;
  const batch = pendingEvents.filter((item) => item.target === target).slice(0, 40);
  if (batch.length === 0) return;

  flushPromise = (async () => {
    try {
      const response = await fetch(target, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch.map((item) => item.event) }),
      });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        const completed = new Set(batch.map((item) => item.event.eventId));
        for (let index = pendingEvents.length - 1; index >= 0; index -= 1) {
          if (completed.has(pendingEvents[index].event.eventId)) pendingEvents.splice(index, 1);
        }
      }
    } catch {
      // Keep the in-memory batch for the next event, visibility change or online event.
    }
  })().finally(() => {
    flushPromise = null;
    if (pendingEvents.length > 0 && navigator.onLine) void flushAnonymousEvents();
  });

  await flushPromise;
}

function installFlushListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  window.addEventListener('online', () => void flushAnonymousEvents());
  window.addEventListener('pagehide', () => void flushAnonymousEvents());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAnonymousEvents();
  });
}

export function recordAnonymousFeedEvent(
  entityType: AnonymousEntityType,
  entityId: string | number,
  eventType: AnonymousEventType,
  durationMs = 0,
  endpoint?: string,
): void {
  if (typeof window === 'undefined') return;
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
  pendingEvents.push({ target: getEndpoint(endpoint), event });
  if (pendingEvents.length > 2000) pendingEvents.splice(0, pendingEvents.length - 2000);
  installFlushListeners();
  void flushAnonymousEvents();
}
