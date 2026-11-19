'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import type { ComponentProps } from 'react';

type SpeedInsightsEvent = Parameters<NonNullable<ComponentProps<typeof SpeedInsights>['beforeSend']>>[0];

function sanitiseSpeedInsightsEvent(data: SpeedInsightsEvent) {
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
