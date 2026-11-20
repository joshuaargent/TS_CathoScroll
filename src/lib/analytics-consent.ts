'use client';

export const analyticsConsentStorageKey = 'cathoscroll.analytics-consent.v1';
export const analyticsConsentChangeEvent = 'cathoscroll:analytics-consent-change';
export const analyticsConsentManageEvent = 'cathoscroll:analytics-consent-manage';
export const analyticsConsentVersion = 1 as const;

export type AnalyticsConsent = {
  version: typeof analyticsConsentVersion;
  serviceImprovement: boolean;
  sponsorMeasurement: boolean;
  updatedAt: string;
};

export type AnalyticsConsentChoice = 'serviceImprovement' | 'sponsorMeasurement';

function emptyConsent(): AnalyticsConsent {
  return {
    version: analyticsConsentVersion,
    serviceImprovement: false,
    sponsorMeasurement: false,
    updatedAt: '',
  };
}

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(analyticsConsentStorageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== analyticsConsentVersion ||
      !('serviceImprovement' in parsed) ||
      typeof parsed.serviceImprovement !== 'boolean' ||
      !('sponsorMeasurement' in parsed) ||
      typeof parsed.sponsorMeasurement !== 'boolean' ||
      !('updatedAt' in parsed) ||
      typeof parsed.updatedAt !== 'string'
    ) return null;
    return {
      version: analyticsConsentVersion,
      serviceImprovement: parsed.serviceImprovement,
      sponsorMeasurement: parsed.sponsorMeasurement,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return readAnalyticsConsent() ?? emptyConsent();
}

export function hasAnalyticsConsent(choice: AnalyticsConsentChoice): boolean {
  return getAnalyticsConsent()[choice] === true;
}

export function saveAnalyticsConsent(
  choices: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
): AnalyticsConsent {
  if (typeof window === 'undefined') throw new Error('Analytics preferences are unavailable.');
  const next: AnalyticsConsent = {
    version: analyticsConsentVersion,
    serviceImprovement: choices.serviceImprovement === true,
    sponsorMeasurement: choices.sponsorMeasurement === true,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(analyticsConsentStorageKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, { detail: next }));
  return next;
}

export function openAnalyticsConsentManager(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(analyticsConsentManageEvent));
}
