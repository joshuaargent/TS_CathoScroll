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

const storagePrefix = 'cathoscroll.sponsor-events.v1.';
const flushingUsers = new Set<string>();

function storageKey(userId: string): string {
  return storagePrefix + userId;
}

function acknowledgeEvent(userId: string, eventId: string): boolean {
  if (typeof window === 'undefined') return false;
  const latest = readQueue(userId);
  const remaining = latest.filter((queued) => queued.eventId !== eventId);
  try {
    if (remaining.length === 0) {
      window.localStorage.removeItem(storageKey(userId));
    } else {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(remaining));
    }
    return true;
  } catch {
    return false;
  }
}

function readQueue(userId: string): QueuedSponsorCampaignEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event): event is QueuedSponsorCampaignEvent =>
      Boolean(event) &&
      typeof event === 'object' &&
      typeof event.campaignId === 'string' &&
      typeof event.eventId === 'string' &&
      typeof event.sessionId === 'string' &&
      (event.eventType === 'viewable_impression' || event.eventType === 'click')
    );
  } catch {
    return [];
  }
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
    queue.push(event);
    try {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(queue));
    } catch {
      return false;
    }
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
