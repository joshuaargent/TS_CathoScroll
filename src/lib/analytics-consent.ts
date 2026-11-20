'use client';

export const analyticsConsentStorageKey = 'cathoscroll.analytics-consent.v1';
export const analyticsConsentChangeEvent = 'cathoscroll:analytics-consent-change';
export const analyticsConsentManageEvent = 'cathoscroll:analytics-consent-manage';
export const analyticsConsentVersion = 1 as const;

function storageKeyForUser(userId?: string | null): string {
  return userId
    ? analyticsConsentStorageKey + '.account.' + encodeURIComponent(userId)
    : analyticsConsentStorageKey + '.anonymous';
}

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

export function readAnalyticsConsent(userId?: string | null): AnalyticsConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKeyForUser(userId));
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

export function getAnalyticsConsent(userId?: string | null): AnalyticsConsent {
  return readAnalyticsConsent(userId) ?? emptyConsent();
}

export function hasAnalyticsConsent(choice: AnalyticsConsentChoice, userId?: string | null): boolean {
  return getAnalyticsConsent(userId)[choice] === true;
}

export function saveAnalyticsConsent(
  choices: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>,
  userId?: string | null
): AnalyticsConsent {
  if (typeof window === 'undefined') throw new Error('Analytics preferences are unavailable.');
  const next: AnalyticsConsent = {
    version: analyticsConsentVersion,
    serviceImprovement: choices.serviceImprovement === true,
    sponsorMeasurement: choices.sponsorMeasurement === true,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(storageKeyForUser(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, { detail: { userId: userId ?? null, consent: next } }));
  return next;
}

export function openAnalyticsConsentManager(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(analyticsConsentManageEvent));
}


export function createConsentBoundAbortSignal(
  choice: AnalyticsConsentChoice,
  userId?: string | null
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  if (typeof window === 'undefined') {
    return { signal: controller.signal, dispose: () => undefined };
  }
  const expectedUserId = userId ?? null;
  const onConsentChange = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
    if ((detail?.userId ?? null) === expectedUserId && !hasAnalyticsConsent(choice, userId)) {
      controller.abort();
    }
  };
  window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
  return {
    signal: controller.signal,
    dispose: () => window.removeEventListener(analyticsConsentChangeEvent, onConsentChange),
  };
}
