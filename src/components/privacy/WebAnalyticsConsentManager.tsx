'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { AnalyticsConsentManager } from '@/components/privacy/AnalyticsConsentManager';

export function WebAnalyticsConsentManager() {
  const { user } = useAuth();
  return <AnalyticsConsentManager userId={user?.id ?? null} />;
}
