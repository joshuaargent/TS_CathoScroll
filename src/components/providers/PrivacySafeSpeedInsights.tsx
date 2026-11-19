'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';

function sanitiseSpeedInsightsEvent(data: { url: string; [key: string]: unknown }) {
  const url = new URL(data.url);
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
  return { ...data, url: url.toString() };
}

export function PrivacySafeSpeedInsights() {
  return <SpeedInsights beforeSend={sanitiseSpeedInsightsEvent} />;
}
