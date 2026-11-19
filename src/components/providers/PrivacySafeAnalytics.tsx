'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';

// Vercel Web Analytics remains enabled for aggregate site-level measurement,
// but content-specific paths and query strings must never leave the application.
// Collapse every page view to the site root so topic slugs cannot become a
// third-party browsing history.
function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
}

export function PrivacySafeAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} />;
}
