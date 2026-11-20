'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import { useCallback, useSyncExternalStore, type ComponentProps } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { analyticsConsentChangeEvent, hasAnalyticsConsent } from '@/lib/analytics-consent';

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

function subscribe(onChange: () => void) {
  window.addEventListener(analyticsConsentChangeEvent, onChange);
  return () => window.removeEventListener(analyticsConsentChangeEvent, onChange);
}

export function PrivacySafeSpeedInsights() {
  const { user } = useAuth();
  const getSnapshot = useCallback(
    () => hasAnalyticsConsent('serviceImprovement', user?.id ?? null),
    [user?.id]
  );
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!enabled) return null;
  return <SpeedInsights beforeSend={sanitiseSpeedInsightsEvent} />;
}
