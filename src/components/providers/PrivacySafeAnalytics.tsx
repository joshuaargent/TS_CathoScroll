'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';

function sanitisePageUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname;
  const sensitiveContentRoutes = [
    /^\/(?:topic|topics)\/[^/]+(?:\/.*)?$/i,
    /^\/categories\/[^/]+(?:\/.*)?$/i,
    /^\/search(?:\/.*)?$/i,
  ];

  if (sensitiveContentRoutes.some((pattern) => pattern.test(path))) {
    const match = path.match(/^\/(topic|topics|categories|search)/i);
    url.pathname = match ? `/${match[1].toLowerCase()}/[content]` : '/content';
  }

  url.search = '';
  url.hash = '';
  return url.toString();
}

function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: sanitisePageUrl(event.url) };
}

export function PrivacySafeAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} />;
}
