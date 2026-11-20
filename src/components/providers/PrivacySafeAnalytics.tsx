'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';
import { analyticsConsentChangeEvent, hasAnalyticsConsent } from '@/lib/analytics-consent';

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

function subscribe(onChange: () => void) {
  window.addEventListener(analyticsConsentChangeEvent, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(analyticsConsentChangeEvent, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function PrivacySafeAnalytics() {
  const { user, loading } = useAuth();
  const getSnapshot = useCallback(
    () => hasAnalyticsConsent('serviceImprovement', user?.id ?? null),
    [user?.id]
  );
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const beforeSend = useCallback((event: BeforeSendEvent) => {
    if (loading || !hasAnalyticsConsent('serviceImprovement', user?.id ?? null)) return null;
    return redactAnalyticsEvent(event);
  }, [loading, user?.id]);
  if (loading || !enabled) return null;
  return <Analytics beforeSend={beforeSend} />;
}
