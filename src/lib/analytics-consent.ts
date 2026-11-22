'use client';

import { migrateLegacyAnonymousAnalyticsPreferences } from './anonymous-analytics-preferences';

export const analyticsConsentStorageKey = 'cathoscroll.analytics-consent.v2';
export const analyticsConsentChangeEvent = 'cathoscroll:analytics-consent-change';
export const analyticsConsentManageEvent = 'cathoscroll:analytics-consent-manage';
export const analyticsConsentSyncEvent = 'cathoscroll:analytics-consent-sync';

export function requestAnalyticsConsentSync(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(analyticsConsentSyncEvent));
}
export const analyticsConsentVersion = 2 as const;

function storageKeyForUser(userId?: string | null): string {
  return userId
    ? analyticsConsentStorageKey + '.account.' + encodeURIComponent(userId)
    : analyticsConsentStorageKey + '.anonymous';
}

export function getAnalyticsConsentStorageKey(userId?: string | null): string {
  return storageKeyForUser(userId);
}

export type AnalyticsConsent = {
  version: typeof analyticsConsentVersion;
  serviceImprovement: boolean;
  sponsorMeasurement: boolean;
  updatedAt: string;
  syncPending: boolean;
  pendingPurposes: AnalyticsConsentChoice[];
};

export type AnalyticsConsentChoice = 'serviceImprovement' | 'sponsorMeasurement';

const deniedOverrides = new Set<string>();
let consentChannel: BroadcastChannel | null = null;

function overrideKey(choice: AnalyticsConsentChoice, userId?: string | null): string {
  return storageKeyForUser(userId) + ':' + choice;
}

function getConsentChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (consentChannel) return consentChannel;
  try {
    consentChannel = new BroadcastChannel('cathoscroll:analytics-consent');
    consentChannel.addEventListener('message', (event: MessageEvent<{
      type?: 'deny' | 'allow';
      choice?: AnalyticsConsentChoice;
      userId?: string | null;
    }>) => {
      const message = event.data;
      if (!message?.choice || !['serviceImprovement', 'sponsorMeasurement'].includes(message.choice)) return;
      const key = overrideKey(message.choice, message.userId ?? null);
      if (message.type === 'deny') deniedOverrides.add(key);
      else if (message.type === 'allow') deniedOverrides.delete(key);
      window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, {
        detail: { userId: message.userId ?? null },
      }));
    });
    return consentChannel;
  } catch {
    consentChannel = null;
    return null;
  }
}

export function denyAnalyticsConsentInMemory(
  choice: AnalyticsConsentChoice,
  userId?: string | null
): void {
  const expectedUserId = userId ?? null;
  deniedOverrides.add(overrideKey(choice, expectedUserId));
  window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, {
    detail: { userId: expectedUserId },
  }));
  getConsentChannel()?.postMessage({
    type: 'deny',
    choice,
    userId: expectedUserId,
  });
}

function emptyConsent(): AnalyticsConsent {
  return {
    version: analyticsConsentVersion,
    serviceImprovement: false,
    sponsorMeasurement: false,
    updatedAt: '',
    syncPending: false,
    pendingPurposes: [],
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
      typeof parsed.updatedAt !== 'string' ||
      ('syncPending' in parsed && typeof parsed.syncPending !== 'boolean') ||
      ('pendingPurposes' in parsed && (
        !Array.isArray(parsed.pendingPurposes) ||
        !parsed.pendingPurposes.every((choice: unknown) => choice === 'serviceImprovement' || choice === 'sponsorMeasurement')
      ))
    ) return null;
    const parsedSyncPending = 'syncPending' in parsed && parsed.syncPending === true;
    const pendingPurposes: AnalyticsConsentChoice[] = 'pendingPurposes' in parsed
      ? parsed.pendingPurposes as AnalyticsConsentChoice[]
      : parsedSyncPending ? ['serviceImprovement', 'sponsorMeasurement'] : [];
    const serviceDenied = deniedOverrides.has(overrideKey('serviceImprovement', userId));
    const sponsorDenied = deniedOverrides.has(overrideKey('sponsorMeasurement', userId));
    const storageWriteFailedForDenial = Boolean(userId) && (
      (serviceDenied && parsed.serviceImprovement) ||
      (sponsorDenied && parsed.sponsorMeasurement)
    );
    const effectivePendingPurposes = storageWriteFailedForDenial
      ? Array.from(new Set([
          ...pendingPurposes,
          ...(serviceDenied && parsed.serviceImprovement ? ['serviceImprovement' as const] : []),
          ...(sponsorDenied && parsed.sponsorMeasurement ? ['sponsorMeasurement' as const] : []),
        ]))
      : pendingPurposes;
    return {
      version: analyticsConsentVersion,
      serviceImprovement: parsed.serviceImprovement && !serviceDenied,
      sponsorMeasurement: parsed.sponsorMeasurement && !sponsorDenied,
      updatedAt: parsed.updatedAt,
      syncPending: parsedSyncPending || storageWriteFailedForDenial,
      pendingPurposes: effectivePendingPurposes,
    };
  } catch {
    return null;
  }
}

export function clearLegacyAnalyticsConsentStorage(): void {
  if (typeof window === 'undefined') return;
  migrateLegacyAnonymousAnalyticsPreferences();
  const legacyPrefix = 'cathoscroll.analytics-consent.v1';
  try {
    window.localStorage.removeItem(legacyPrefix);
    window.localStorage.removeItem(legacyPrefix + '.anonymous');
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(legacyPrefix + '.account.')) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.removeItem('cathoscroll.anonymous-analytics.enabled.v1');
  } catch {
    // The v2 namespace is authoritative and old values are never read.
  }
}

export function clearLegacyAnonymousAnalyticsConsent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKeyForUser(null));
  } catch {
    // The signed-out consent gate still returns false if storage is unavailable.
  }
  clearLegacyAnalyticsConsentStorage();
  for (const choice of ['serviceImprovement', 'sponsorMeasurement'] as const) {
    deniedOverrides.add(overrideKey(choice, null));
    getConsentChannel()?.postMessage({ type: 'deny', choice, userId: null });
  }
  window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, { detail: { userId: null } }));
}

export function getAnalyticsConsent(userId?: string | null): AnalyticsConsent {
  return readAnalyticsConsent(userId) ?? emptyConsent();
}

export function hasAnalyticsConsent(choice: AnalyticsConsentChoice, userId?: string | null): boolean {
  // Optional analytics are account-only. Signed-out visitors have no
  // anonymous analytics or sponsor delivery measurement.
  if (!userId) return false;
  if (deniedOverrides.has(overrideKey(choice, userId))) return false;
  return getAnalyticsConsent(userId)[choice] === true;
}

export function hasSyncedAnalyticsConsent(choice: AnalyticsConsentChoice, userId?: string | null): boolean {
  const consent = readAnalyticsConsent(userId);
  return hasAnalyticsConsent(choice, userId) && consent?.syncPending !== true;
}

export function saveAnalyticsConsent(
  choices: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>,
  userId?: string | null,
  options: { updatedAt?: string; syncPending?: boolean; pendingPurposes?: AnalyticsConsentChoice[] } = {}
): AnalyticsConsent {
  if (typeof window === 'undefined') throw new Error('Analytics preferences are unavailable.');
  const syncPending = options.syncPending ?? Boolean(userId);
  const next: AnalyticsConsent = {
    version: analyticsConsentVersion,
    serviceImprovement: choices.serviceImprovement === true,
    sponsorMeasurement: choices.sponsorMeasurement === true,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    syncPending,
    pendingPurposes: options.pendingPurposes ?? (syncPending ? ['serviceImprovement', 'sponsorMeasurement'] : []),
  };
  window.localStorage.setItem(storageKeyForUser(userId), JSON.stringify(next));
  for (const choice of ['serviceImprovement', 'sponsorMeasurement'] as const) {
    const key = overrideKey(choice, userId);
    if (next[choice]) {
      deniedOverrides.delete(key);
      getConsentChannel()?.postMessage({ type: 'allow', choice, userId: userId ?? null });
    } else {
      deniedOverrides.add(key);
      getConsentChannel()?.postMessage({ type: 'deny', choice, userId: userId ?? null });
    }
  }
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
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === storageKeyForUser(expectedUserId) && !hasAnalyticsConsent(choice, userId)) {
      controller.abort();
    }
  };
  window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
  window.addEventListener('storage', onStorageChange);
  return {
    signal: controller.signal,
    dispose: () => {
      window.removeEventListener(analyticsConsentChangeEvent, onConsentChange);
      window.removeEventListener('storage', onStorageChange);
    },
  };
}
