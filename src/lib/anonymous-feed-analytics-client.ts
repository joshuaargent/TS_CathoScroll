'use client';

type AnonymousEntityType = 'topic' | 'comment';
type AnonymousEventType = 'impression' | 'viewable_impression' | 'active_duration' | 'skip' | 'completion' | 'open';

function uuid(): string | null {
  try { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null; }
  catch { return null; }
}

export function recordAnonymousFeedEvent(
  entityType: AnonymousEntityType,
  entityId: string | number,
  eventType: AnonymousEventType,
  durationMs = 0,
  endpoint?: string,
): void {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  const eventId = uuid();
  const id = String(entityId);
  if (!eventId || !id || id.length > 160) return;
  const event = {
    eventId,
    entityType,
    entityId: id,
    eventType,
    ...(eventType === 'active_duration' ? { durationMs: Math.max(0, Math.min(60000, Math.round(durationMs))) } : {}),
  };
  const nativeOrigin = typeof window !== 'undefined' && (
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'capacitor-electron:' ||
    window.location.origin === 'http://localhost' ||
    window.location.origin === 'https://localhost'
  ) ? 'https://cathoscroll.com' : undefined;
  const target = endpoint ?? (nativeOrigin
    ? new URL('/api/analytics/anonymous-events', nativeOrigin).toString()
    : '/api/analytics/anonymous-events');
  void fetch(target, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => undefined);
}
