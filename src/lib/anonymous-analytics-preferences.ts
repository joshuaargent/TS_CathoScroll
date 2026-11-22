'use client';

export const anonymousAnalyticsPreferenceStorageKey = 'cathoscroll.anonymous-analytics-preferences.v2';
export const anonymousAnalyticsPreferenceChangeEvent = 'cathoscroll:anonymous-analytics-preference-change';

export type AnonymousAnalyticsPurpose = 'serviceImprovement' | 'sponsorMeasurement';

export type AnonymousAnalyticsPreferences = {
  version: 2;
  serviceImprovementObjected: boolean;
  sponsorMeasurementObjected: boolean;
  updatedAt: string;
};

const defaultPreferences: AnonymousAnalyticsPreferences = {
  version: 2,
  serviceImprovementObjected: false,
  sponsorMeasurementObjected: false,
  updatedAt: '',
};

function validPreferences(value: unknown): value is AnonymousAnalyticsPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 2 &&
    typeof record.serviceImprovementObjected === 'boolean' &&
    typeof record.sponsorMeasurementObjected === 'boolean' &&
    typeof record.updatedAt === 'string';
}

export function migrateLegacyAnonymousAnalyticsPreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(anonymousAnalyticsPreferenceStorageKey) !== null) return;

    let serviceImprovementObjected = false;
    let sponsorMeasurementObjected = false;
    let foundLegacyChoice = false;

    for (const key of [
      'cathoscroll.analytics-consent.v1.anonymous',
      'cathoscroll.analytics-consent.v2.anonymous',
    ]) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record.serviceImprovement === 'boolean') {
        serviceImprovementObjected = !record.serviceImprovement;
        foundLegacyChoice = true;
      }
      if (typeof record.sponsorMeasurement === 'boolean') {
        sponsorMeasurementObjected = !record.sponsorMeasurement;
        foundLegacyChoice = true;
      }
      if (foundLegacyChoice) break;
    }

    const legacyToggle = window.localStorage.getItem('cathoscroll.anonymous-analytics.enabled.v1');
    if (!foundLegacyChoice && (legacyToggle === 'true' || legacyToggle === 'false')) {
      serviceImprovementObjected = legacyToggle !== 'true';
      foundLegacyChoice = true;
    }

    if (foundLegacyChoice) {
      const migrated: AnonymousAnalyticsPreferences = {
        version: 2,
        serviceImprovementObjected,
        sponsorMeasurementObjected,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(anonymousAnalyticsPreferenceStorageKey, JSON.stringify(migrated));
    }
  } catch {
    // If a previous choice cannot be read or migrated, collection fails closed
    // until the visitor can save a fresh preference.
  }
}

export function readAnonymousAnalyticsPreferences(): AnonymousAnalyticsPreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    migrateLegacyAnonymousAnalyticsPreferences();
    const raw = window.localStorage.getItem(anonymousAnalyticsPreferenceStorageKey);
    if (!raw) return defaultPreferences;
    const parsed: unknown = JSON.parse(raw);
    return validPreferences(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAnonymousAnalyticsAllowed(purpose: AnonymousAnalyticsPurpose): boolean {
  const preferences = readAnonymousAnalyticsPreferences();
  if (!preferences) return false;
  return purpose === 'serviceImprovement'
    ? !preferences.serviceImprovementObjected
    : !preferences.sponsorMeasurementObjected;
}

export function saveAnonymousAnalyticsObjection(
  purpose: AnonymousAnalyticsPurpose,
  objected: boolean,
): AnonymousAnalyticsPreferences {
  if (typeof window === 'undefined') throw new Error('Anonymous analytics preferences are unavailable.');
  const current = readAnonymousAnalyticsPreferences();
  if (!current) throw new Error('The current anonymous analytics preference could not be read.');
  const next: AnonymousAnalyticsPreferences = {
    ...current,
    ...(purpose === 'serviceImprovement'
      ? { serviceImprovementObjected: objected }
      : { sponsorMeasurementObjected: objected }),
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(anonymousAnalyticsPreferenceStorageKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(anonymousAnalyticsPreferenceChangeEvent, {
    detail: { purpose, objected, preferences: next },
  }));
  return next;
}

export function createAnonymousAnalyticsAbortSignal(
  purpose: AnonymousAnalyticsPurpose,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  if (typeof window === 'undefined') return { signal: controller.signal, dispose: () => undefined };

  const onPreferenceChange = (event: Event) => {
    const detail = (event as CustomEvent<{ purpose?: AnonymousAnalyticsPurpose }>).detail;
    if ((!detail?.purpose || detail.purpose === purpose) && !isAnonymousAnalyticsAllowed(purpose)) {
      controller.abort();
    }
  };
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === anonymousAnalyticsPreferenceStorageKey && !isAnonymousAnalyticsAllowed(purpose)) {
      controller.abort();
    }
  };
  window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, onPreferenceChange);
  window.addEventListener('storage', onStorageChange);
  if (!isAnonymousAnalyticsAllowed(purpose)) controller.abort();

  return {
    signal: controller.signal,
    dispose: () => {
      window.removeEventListener(anonymousAnalyticsPreferenceChangeEvent, onPreferenceChange);
      window.removeEventListener('storage', onStorageChange);
    },
  };
}
