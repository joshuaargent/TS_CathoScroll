'use client';

import { AnalyticsConsentSettingsButton } from '@/components/privacy/AnalyticsConsentManager';

// Compatibility wrapper for older page imports. The former signed-out-only
// toggle is replaced by the central two-purpose consent manager.
export function AnonymousAnalyticsPreference() {
  return <AnalyticsConsentSettingsButton />;
}
