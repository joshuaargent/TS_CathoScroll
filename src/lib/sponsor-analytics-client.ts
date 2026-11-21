'use client';

import type { SignedInAnalyticsOutbox } from './offline/signed-in-analytics-store';
import { analyticsConsentChangeEvent, createConsentBoundAbortSignal, hasAnalyticsConsent, hasSyncedAnalyticsConsent } from './analytics-consent';

export type SponsorCampaignEventType = 'viewable_impression' | 'click';

export interface QueuedSponsorCampaignEvent {
  campaignId: string;
  eventId: string;
  sessionId: string;
  placementReceipt: string;
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
const activeSponsorTransports = new Map<string, { getAccessToken: AccessTokenProvider; apiBaseUrl?: string }>();
let persistentOutbox: SignedInAnalyticsOutbox | null = null;

export async function configureSponsorAnalyticsOutbox(outbox: SignedInAnalyticsOutbox): Promise<void> {
  await outbox.initialize();
  persistentOutbox = outbox;
  for (const [userId, transport] of activeSponsorTransports) {
    void flushSponsorCampaignEvents(userId, transport.getAccessToken, transport.apiBaseUrl);
  }
}

export async function clearSponsorAnalyticsOutbox(userId: string): Promise<void> {
  pendingQueues.delete(userId);
  if (persistentOutbox) await persistentOutbox.clearStream(userId, 'sponsor');
}

function sponsorEventFromPayload(payload: { event_id: string; session_id: string; event_type: string; campaign_id?: unknown; placement_receipt?: unknown }): QueuedSponsorCampaignEvent | null {
  if (typeof payload.campaign_id !== 'string' || !payload.campaign_id ||
      typeof payload.placement_receipt !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.placement_receipt) ||
      (payload.event_type !== 'viewable_impression' && payload.event_type !== 'click')) return null;
  return { campaignId: payload.campaign_id, eventId: payload.event_id, sessionId: payload.session_id, placementReceipt: payload.placement_receipt, eventType: payload.event_type };
}

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
  if (typeof window === 'undefined' || !userId || !hasAnalyticsConsent('sponsorMeasurement', userId)) return false;
  const queue = readQueue(userId);
  const alreadyQueued = queue.some(
    (queued) =>
      queued.campaignId === event.campaignId &&
      queued.sessionId === event.sessionId &&
      queued.eventType === event.eventType
  );
  if (alreadyQueued) {
    void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
    return true;
  }
  if (persistentOutbox) {
    void persistentOutbox.enqueue(userId, 'sponsor', {
      event_id: event.eventId,
      session_id: event.sessionId,
      event_type: event.eventType,
      campaign_id: event.campaignId,
      placement_receipt: event.placementReceipt,
    }).then(() => flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl)).catch((error: unknown) => {
      console.error('Unable to persist signed-in sponsor analytics:', error);
      if (queue.length < queueLimit) {
        queue.push(event);
        pendingQueues.set(userId, queue);
      }
      void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
    });
    return true;
  }
  // Preserve older unacknowledged events in this active page and bound memory.
  if (queue.length >= queueLimit) return false;
  queue.push(event);
  pendingQueues.set(userId, queue);
  void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
  return true;
}

export async function flushSponsorCampaignEvents(
  userId: string,
  getAccessToken: AccessTokenProvider,
  apiBaseUrl?: string
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent('sponsorMeasurement', userId)) {
    pendingQueues.delete(userId);
    if (persistentOutbox) {
      try { await persistentOutbox.clearStream(userId, 'sponsor'); }
      catch (cause) { console.error('Unable to clear withdrawn sponsor analytics:', cause); }
    }
    return;
  }
  // Retain newly queued events until the server has acknowledged an offline
  // Sponsor measurement opt-in.
  if (!hasSyncedAnalyticsConsent('sponsorMeasurement', userId)) return;
  if (typeof navigator === 'undefined' || !navigator.onLine || flushingUsers.has(userId)) return;

  flushingUsers.add(userId);
  const consentRequest = createConsentBoundAbortSignal('sponsorMeasurement', userId);
  try {
    for (;;) {
      if (!hasAnalyticsConsent('sponsorMeasurement', userId)) {
        pendingQueues.delete(userId);
        if (persistentOutbox) await persistentOutbox.clearStream(userId, 'sponsor');
        break;
      }
      const stored = persistentOutbox ? await persistentOutbox.pending(userId, 'sponsor', 1) : [];
      const persistedEvent = stored[0];
      const event = persistedEvent ? sponsorEventFromPayload(persistedEvent) : readQueue(userId)[0];
      if (persistedEvent && !event) {
        await persistentOutbox!.acknowledge(userId, 'sponsor', [persistedEvent.event_id]);
        continue;
      }
      if (!event) break;

      let accessToken: string | null;
      try {
        accessToken = await getAccessToken();
      } catch {
        break;
      }
      if (!accessToken || consentRequest.signal.aborted || !hasAnalyticsConsent('sponsorMeasurement', userId)) break;

      let response: Response;
      try {
        response = await fetch(eventEndpoint(apiBaseUrl), {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          signal: consentRequest.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(event),
        });
      } catch {
        break;
      }
      if (!hasAnalyticsConsent('sponsorMeasurement', userId)) {
        pendingQueues.delete(userId);
        if (persistentOutbox) await persistentOutbox.clearStream(userId, 'sponsor');
        break;
      }
      if (!response.ok) {
        // A placement can expire while the device is offline. These client
        // errors are terminal for that event; do not let one stale item block
        // every newer sponsor event behind it. Transient auth/rate/server
        // failures remain queued for a later retry.
        if (
          (response.status === 400 || response.status === 403)
        ) {
          if (persistedEvent && persistentOutbox) await persistentOutbox.acknowledge(userId, 'sponsor', [event.eventId]);
          else acknowledgeEvent(userId, event.eventId);
          continue;
        }
        break;
      }

      // Stable IDs make replay safe if the server accepted the event but the
      // local acknowledgement write failed or the app closed mid-flight.
      if (persistedEvent && persistentOutbox) await persistentOutbox.acknowledge(userId, 'sponsor', [event.eventId]);
      else if (!acknowledgeEvent(userId, event.eventId)) break;
    }
  } finally {
    consentRequest.dispose();
    flushingUsers.delete(userId);
  }
}

export function installSponsorAnalyticsListeners(
  userId: string,
  getAccessToken: AccessTokenProvider,
  apiBaseUrl?: string
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const installedTransport = { getAccessToken, apiBaseUrl };
  activeSponsorTransports.set(userId, installedTransport);
  const flush = () => void flushSponsorCampaignEvents(userId, getAccessToken, apiBaseUrl);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') flush();
  };

  const onConsentChange = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
    if ((detail?.userId ?? null) === userId) flush();
  };
  window.addEventListener('online', flush);
  window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
  window.addEventListener('pageshow', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Drain any events left by a previous sponsor placement or app session.
  flush();

  return () => {
    window.removeEventListener('online', flush);
    window.removeEventListener(analyticsConsentChangeEvent, onConsentChange);
    window.removeEventListener('pageshow', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (activeSponsorTransports.get(userId) === installedTransport) activeSponsorTransports.delete(userId);
  };
}
