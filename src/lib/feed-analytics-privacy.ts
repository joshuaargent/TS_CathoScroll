'use client';

// Remove queued, unsent content-level telemetry when its collection gate is off.
// These queues contain topic/comment identifiers and must not be retained on-device
// for a future deployment to upload unexpectedly.
export function clearPendingContentAnalyticsQueues(): void {
  if (typeof window === 'undefined') return;

  const prefixes = [
    'cathoscroll.feed-analytics.v1.',
    'cathoscroll:feed-card-analytics:v1:',
  ];

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Analytics cleanup must never interfere with feed navigation or learning.
  }
}
