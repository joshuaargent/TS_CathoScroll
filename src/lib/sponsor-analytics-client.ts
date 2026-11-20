'use client';

export type SponsorCampaignEventType = 'viewable_impression' | 'click';

export interface QueuedSponsorCampaignEvent {
  campaignId: string;
  eventId: string;
  sessionId: string;
  eventType: SponsorCampaignEventType;
}

type AccessTokenProvider = () => Promise<string | null>;

function eventEndpoint(apiBaseUrl?: string): string {
  return apiBaseUrl
    ? new URL('/api/content/sponsor-campaign-events', apiBaseUrl).toString()
    : '/api/content/sponsor-campaign-events';
}

const pendingQueues = new Map<string, QueuedSponsorCampaignEvent[]>();
const queueLimit = 1000;
const flushingUsers = new Set<string>();

function readQueue(userId: string): QueuedSponsorCampaignEvent[] {
  return pendingQueues.get(userId) ?? [];
}

function acknowledgeEvent(userId: string, eventId: string): boolean {
  const remaining = readQueue(userId).filter((queued) => queued.eventId !== eventId);
  if (remaining.length === 0) pendingQueues.delete(userId);
  else pendingQueues.set(userId, remaining);
  return true;
}

export function recordSponsorCampaignEvent(
  userId: string,
  event: QueuedSponsorCampaignEvent,
  getAccessToken: AccessTokenProvider,
  apiBaseUrl?: string
): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  const queue = readQueue(userId);
  const alreadyQueued = queue.some(
    (queued) =>
      queued.campaignId === event.campaignId &&
      queued.sessionId === event.sessionId &&
      queued.eventType === event.eventType
  );
  if (!alreadyQueued) {
    // Preserve older unacknowledged events in this active page and bound memory.
    if (queue.length >= queueLimit) return false;
    queue.push(event);
    pendingQueues.set(userId, queue);
  }
  void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
  return true;
}

export async function flushSponsorCampaignEvents(
  userId: string,
  getAccessToken: AccessTokenProvider,
  apiBaseUrl?: string
): Promise<void> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.onLine ||
    flushingUsers.has(userId)
  ) return;

  flushingUsers.add(userId);
  try {
    for (;;) {
      const event = readQueue(userId)[0];
      if (!event) break;

      let accessToken: string | null;
      try {
        accessToken = await getAccessToken();
      } catch {
        break;
      }
      if (!accessToken) break;

      let response: Response;
      try {
        response = await fetch(eventEndpoint(apiBaseUrl), {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(event),
        });
      } catch {
        break;
      }
      if (!response.ok) {
        // A placement can expire while the device is offline. These client
        // errors are terminal for that event; do not let one stale item block
        // every newer sponsor event behind it. Transient auth/rate/server
        // failures remain queued for a later retry.
        if (
          (response.status === 400 || response.status === 403) &&
          acknowledgeEvent(userId, event.eventId)
        ) continue;
        break;
      }

      // Stable IDs make replay safe if the server accepted the event but the
      // local acknowledgement write failed or the app closed mid-flight.
      if (!acknowledgeEvent(userId, event.eventId)) break;
    }
  } finally {
    flushingUsers.delete(userId);
  }
}

export function installSponsorAnalyticsListeners(
  userId: string,
  getAccessToken: AccessTokenProvider,
  apiBaseUrl?: string
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const flush = () => void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') flush();
  };

  window.addEventListener('online', flush);
  window.addEventListener('pageshow', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Drain any events left by a previous sponsor placement or app session.
  flush();

  return () => {
    window.removeEventListener('online', flush);
    window.removeEventListener('pageshow', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export interface AnonymousQueuedSponsorCampaignEvent extends QueuedSponsorCampaignEvent {
  placementKey: string;
}

const anonymousQueue: { event: AnonymousQueuedSponsorCampaignEvent; apiBaseUrl?: string }[] = [];
let anonymousFlushInProgress = false;
let anonymousListenersInstalled = false;

function anonymousEventEndpoint(apiBaseUrl?: string): string {
  return apiBaseUrl
    ? new URL('/api/content/sponsor-campaign-events', apiBaseUrl).toString()
    : '/api/content/sponsor-campaign-events';
}

export async function flushAnonymousSponsorCampaignEvents(): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.onLine || anonymousFlushInProgress) return;
  anonymousFlushInProgress = true;
  try {
    while (anonymousQueue.length > 0 && navigator.onLine) {
      const queued = anonymousQueue[0];
      let response: Response;
      try {
        response = await fetch(anonymousEventEndpoint(queued.apiBaseUrl), {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...queued.event, sessionId: queued.event.sessionId, placementKey: queued.event.placementKey }),
        });
      } catch {
        break;
      }
      if (!response.ok && response.status !== 400 && response.status !== 403) break;
      anonymousQueue.shift();
    }
  } finally {
    anonymousFlushInProgress = false;
  }
}

export function installAnonymousSponsorAnalyticsListeners(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (!anonymousListenersInstalled) {
    anonymousListenersInstalled = true;
    const flush = () => void flushAnonymousSponsorCampaignEvents();
    window.addEventListener('online', flush);
    window.addEventListener('pageshow', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
  }
  void flushAnonymousSponsorCampaignEvents();
  return () => undefined;
}

export function recordAnonymousSponsorCampaignEvent(
  event: AnonymousQueuedSponsorCampaignEvent,
  apiBaseUrl?: string
): boolean {
  if (typeof window === 'undefined' || !event.campaignId || !event.sessionId || !event.placementKey) return false;
  const alreadyQueued = anonymousQueue.some((queued) =>
    queued.event.campaignId === event.campaignId &&
    queued.event.sessionId === event.sessionId &&
    queued.event.placementKey === event.placementKey &&
    queued.event.eventType === event.eventType
  );
  if (!alreadyQueued) {
    if (anonymousQueue.length >= 1000) return false;
    anonymousQueue.push({ event, apiBaseUrl });
  }
  installAnonymousSponsorAnalyticsListeners();
  void flushAnonymousSponsorCampaignEvents();
  return true;
}
