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
  clear(): Promise<void>;
}

const queueLimit = 2000;
export const anonymousAnalyticsPreferenceKey = 'cathoscroll.anonymous-analytics.enabled.v1';
export const anonymousAnalyticsPreferenceChangeEvent = 'cathoscroll:anonymous-analytics-preference-change';

function anonymousAnalyticsEnabled(): boolean {
  if (typeof window === 'undefined' || anonymousPreferenceTransition || anonymousAnalyticsOptedOut) return false;
  try {
    const optedOut = window.localStorage.getItem(anonymousAnalyticsPreferenceKey) === 'false';
    if (optedOut) anonymousAnalyticsOptedOut = true;
    return !optedOut;
  } catch {
    return !anonymousAnalyticsOptedOut;
  }
}

export function isAnonymousFeedAnalyticsEnabled(): boolean {
  return anonymousAnalyticsEnabled();
}
const recentEventKeys = new Map<string, number>();
const pendingEvents: AnonymousFeedAnalyticsEvent[] = [];
const volatileEventIds = new Set<string>();
let flushPromise: Promise<void> | null = null;
let listenersInstalled = false;
let persistentOutbox: AnonymousFeedAnalyticsOutbox | null = null;
let outboxReady: Promise<void> | null = null;
let anonymousPreferenceGeneration = 0;
let anonymousAnalyticsOptedOut = false;
let anonymousPreferenceTransition = false;
let anonymousFlushAbortController: AbortController | null = null;
const pendingOutboxWrites = new Set<Promise<void>>();

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


async function applyAnonymousFeedAnalyticsPreference(enabled: boolean, persistPreference: boolean): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Analytics preferences are unavailable.');
  anonymousPreferenceTransition = true;
  let failure: unknown = null;
  try {
    if (!enabled) {
      if (persistPreference) {
        try {
          window.localStorage.setItem(anonymousAnalyticsPreferenceKey, 'false');
        } catch (cause) {
          anonymousAnalyticsOptedOut = true;
          throw cause;
        }
      }
      anonymousAnalyticsOptedOut = true;
    }
    anonymousPreferenceGeneration += 1;
    const activeFlush = flushPromise;
    anonymousFlushAbortController?.abort();
    if (activeFlush) await activeFlush;
    if (outboxReady) await outboxReady;
    await Promise.allSettled([...pendingOutboxWrites]);
    pendingEvents.splice(0, pendingEvents.length);
    volatileEventIds.clear();
    recentEventKeys.clear();
    if (persistentOutbox) await persistentOutbox.clear();
    if (enabled) {
      if (persistPreference) window.localStorage.removeItem(anonymousAnalyticsPreferenceKey);
      anonymousAnalyticsOptedOut = false;
    }
  } catch (cause) {
    failure = cause;
    pendingEvents.splice(0, pendingEvents.length);
    volatileEventIds.clear();
    recentEventKeys.clear();
    try {
      if (persistentOutbox) await persistentOutbox.clear();
    } catch {
      // The stored objection remains authoritative; disabled events are never uploaded.
    }
  } finally {
    anonymousPreferenceTransition = false;
    window.dispatchEvent(new Event(anonymousAnalyticsPreferenceChangeEvent));
  }
  if (failure) {
    if (!enabled) throw new Error('Unable to save the anonymous analytics objection.');
    throw failure;
  }
  if (enabled) void flushAnonymousFeedAnalyticsQueue();
}

let anonymousPreferenceUpdateQueue: Promise<void> = Promise.resolve();

function queueAnonymousFeedAnalyticsPreference(enabled: boolean, persistPreference: boolean): Promise<void> {
  const update = anonymousPreferenceUpdateQueue.then(() =>
    applyAnonymousFeedAnalyticsPreference(enabled, persistPreference)
  );
  anonymousPreferenceUpdateQueue = update.catch(() => undefined);
  return update;
}

export function setAnonymousFeedAnalyticsEnabled(enabled: boolean): Promise<void> {
  return queueAnonymousFeedAnalyticsPreference(enabled, true);
}

export async function configureAnonymousFeedAnalyticsOutbox(
  outbox: AnonymousFeedAnalyticsOutbox
): Promise<void> {
  const preferenceGeneration = anonymousPreferenceGeneration;
  const configurePromise = (async () => {
    await outbox.initialize();
    persistentOutbox = outbox;
    if (!isAnonymousFeedAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
      pendingEvents.splice(0, pendingEvents.length);
      volatileEventIds.clear();
      await outbox.clear();
      return;
    }
    for (const event of pendingEvents.slice()) {
      if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
        pendingEvents.splice(0, pendingEvents.length);
        volatileEventIds.clear();
        await outbox.clear();
        return;
      }
      const write = outbox.enqueue(event);
      pendingOutboxWrites.add(write);
      try {
        await write;
        if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
          await outbox.acknowledge([event.eventId]);
          removePendingEvents([event.eventId]);
          return;
        }
        removePendingEvents([event.eventId]);
      } catch {
        if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
          removePendingEvents([event.eventId]);
          return;
        }
        volatileEventIds.add(event.eventId);
      } finally {
        pendingOutboxWrites.delete(write);
      }
    }
    installAnonymousFeedAnalyticsSync();
    void flushAnonymousFeedAnalyticsQueue();
  })();
  outboxReady = configurePromise;
  await configurePromise;
}

export async function flushAnonymousFeedAnalyticsQueue(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!anonymousAnalyticsEnabled()) {
    pendingEvents.splice(0, pendingEvents.length);
    volatileEventIds.clear();
    recentEventKeys.clear();
    if (persistentOutbox) {
      try { await outboxReady; await persistentOutbox.clear(); } catch { /* Disabled analytics are never uploaded. */ }
    }
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.onLine || flushPromise) return;
  if (!persistentOutbox && pendingEvents.length === 0) return;

  const preferenceGeneration = anonymousPreferenceGeneration;
  let shouldContinue = false;
  const controller = new AbortController();
  anonymousFlushAbortController = controller;
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
    const batchIds = batch.map((event) => event.eventId);
    if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
      if (persistentOutbox) {
        if (anonymousAnalyticsEnabled()) await persistentOutbox.acknowledge(batchIds);
        else await persistentOutbox.clear();
      }
      removePendingEvents(batchIds);
      if (!anonymousAnalyticsEnabled()) {
        pendingEvents.splice(0, pendingEvents.length);
        volatileEventIds.clear();
      }
      return;
    }

    try {
      const response = await fetch(getEndpoint(), {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
        if (persistentOutbox) {
          if (anonymousAnalyticsEnabled()) await persistentOutbox.acknowledge(batchIds);
          else await persistentOutbox.clear();
        }
        removePendingEvents(batchIds);
        if (!anonymousAnalyticsEnabled()) {
          pendingEvents.splice(0, pendingEvents.length);
          volatileEventIds.clear();
        }
        return;
      }
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        shouldContinue = true;
        if (persistentOutbox) {
          const durableIds = batchIds.filter((eventId) => !volatileEventIds.has(eventId));
          try {
            await persistentOutbox.acknowledge(durableIds);
          } catch {
            return;
          }
        }
        removePendingEvents(batchIds);
      }
    } catch {
      if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
        if (persistentOutbox && anonymousAnalyticsEnabled()) await persistentOutbox.acknowledge(batchIds);
        removePendingEvents(batchIds);
      }
      // Keep same-generation failed batches for retry after reconnect or app restart.
    }
  })().finally(() => {
    if (anonymousFlushAbortController === controller) anonymousFlushAbortController = null;
    flushPromise = null;
    if (shouldContinue && anonymousAnalyticsEnabled() && preferenceGeneration === anonymousPreferenceGeneration && (
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
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== anonymousAnalyticsPreferenceKey && event.key !== null) return;
      const enabled = event.key === anonymousAnalyticsPreferenceKey
        ? event.newValue !== 'false'
        : window.localStorage.getItem(anonymousAnalyticsPreferenceKey) !== 'false';
      void queueAnonymousFeedAnalyticsPreference(enabled, false).catch((cause) => {
        console.error('Unable to synchronise the anonymous analytics objection across tabs:', cause);
      });
    });
    window.addEventListener('online', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pageshow', () => void flushAnonymousFeedAnalyticsQueue());
    window.addEventListener('pagehide', () => void flushAnonymousFeedAnalyticsQueue());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => void flushAnonymousFeedAnalyticsQueue());
    }
    window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, () => {
      if (anonymousAnalyticsEnabled()) void flushAnonymousFeedAnalyticsQueue();
    });
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
  if (typeof window === 'undefined' || !isAnonymousFeedAnalyticsEnabled()) return;
  const preferenceGeneration = anonymousPreferenceGeneration;
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
    const writePromise = (async () => {
      try {
        if (outboxReady) await outboxReady;
        if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
          removePendingEvents([event.eventId]);
          return;
        }
        if (!pendingEvents.some((pending) => pending.eventId === event.eventId)) return;
        const outbox = persistentOutbox;
        if (!outbox) return;
        const enqueuePromise = outbox.enqueue(event);
        pendingOutboxWrites.add(enqueuePromise);
        try {
          await enqueuePromise;
        } finally {
          pendingOutboxWrites.delete(enqueuePromise);
        }
        if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
          await outbox.acknowledge([event.eventId]);
          removePendingEvents([event.eventId]);
          return;
        }
        removePendingEvents([event.eventId]);
      } catch {
        if (!anonymousAnalyticsEnabled() || preferenceGeneration !== anonymousPreferenceGeneration) {
          removePendingEvents([event.eventId]);
          return;
        }
        volatileEventIds.add(event.eventId);
      }
      if (anonymousAnalyticsEnabled() && preferenceGeneration === anonymousPreferenceGeneration) {
        await flushAnonymousFeedAnalyticsQueue();
      }
    })();
    pendingOutboxWrites.add(writePromise);
    void writePromise.finally(() => pendingOutboxWrites.delete(writePromise));
  } else {
    void flushAnonymousFeedAnalyticsQueue();
  }
}
