'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  analyticsConsentChangeEvent,
  analyticsConsentManageEvent,
  analyticsConsentSyncEvent,
  denyAnalyticsConsentInMemory,
  getAnalyticsConsentStorageKey,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  type AnalyticsConsent,
} from '@/lib/analytics-consent';
import { clearSponsorAnalyticsOutbox } from '@/lib/sponsor-analytics-client';
import {
  clearFeedAnalyticsOutbox,
} from '@/lib/feed-analytics-client';
import {
  clearFeedCardAnalyticsOutbox,
} from '@/lib/feed-card-analytics-client';

export async function clearAnalyticsConsentQueues(
  userId: string | null,
  previous: AnalyticsConsent | null,
  next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
): Promise<void> {
  const clearService = previous === null || previous.serviceImprovement !== next.serviceImprovement;
  const clearSponsor = previous === null || previous.sponsorMeasurement !== next.sponsorMeasurement;
  const tasks: Promise<unknown>[] = [];
  if (clearService) {
    if (userId) {
      tasks.push(clearFeedAnalyticsOutbox(userId));
      tasks.push(clearFeedCardAnalyticsOutbox(userId));
    }
  }
  if (clearSponsor) {
    if (userId) tasks.push(clearSponsorAnalyticsOutbox(userId));
  }
  await Promise.all(tasks);
}

type AnalyticsConsentManagerProps = {
  userId?: string | null;
  loading?: boolean;
  apiBaseUrl?: string;
  getAccessToken?: (expectedUserId?: string) => Promise<string | null>;
};

export function AnalyticsConsentManager({ userId = null, loading = false, apiBaseUrl, getAccessToken }: AnalyticsConsentManagerProps = {}) {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [serviceImprovement, setServiceImprovement] = useState(false);
  const [sponsorMeasurement, setSponsorMeasurement] = useState(false);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);
  const [personalizationStatusKnown, setPersonalizationStatusKnown] = useState(!userId);
  const [personalizationStateUserId, setPersonalizationStateUserId] = useState<string | null>(userId);
  const effectivePersonalizationEnabled = personalizationStateUserId === userId ? personalizationEnabled : false;
  const effectivePersonalizationStatusKnown = personalizationStateUserId === userId ? personalizationStatusKnown : !userId;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeUserIdRef = useRef<string | null>(userId);
  const syncAbortRef = useRef<AbortController | null>(null);
  const consentMutationRef = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const managingRef = useRef(false);

  useEffect(() => {
    activeUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousInert = new Map<HTMLElement, boolean>();
    const setInert = (element: HTMLElement) => {
      if (!previousInert.has(element)) previousInert.set(element, element.inert);
      element.inert = true;
    };

    let branch: HTMLElement | null = dialog;
    while (branch?.parentElement) {
      const parentElement: HTMLElement = branch.parentElement;
      for (const child of Array.from(parentElement.children)) {
        if (child !== branch && child instanceof HTMLElement) setInert(child);
      }
      if (parentElement === document.body) break;
      branch = parentElement;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    const first = focusable()[0];
    (first ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (document.activeElement === lastItem || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      for (const [element, wasInert] of previousInert) element.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      const previousFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [visible]);

  const hydrate = useCallback((consent: AnalyticsConsent | null) => {
    setServiceImprovement(consent?.serviceImprovement ?? false);
    setSponsorMeasurement(consent?.sponsorMeasurement ?? false);
  }, []);

  const clearWithdrawnQueues = useCallback(async (
    previous: AnalyticsConsent | null,
    next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
  ) => {
    await clearAnalyticsConsentQueues(userId, previous, next);
  }, [userId]);

  const syncServerConsent = useCallback(async () => {
    if (loading || !userId || typeof window === 'undefined') return;
    const expectedUserId = userId;
    let requestGeneration = consentMutationRef.current;
    syncAbortRef.current?.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    const readLocalChoiceSnapshot = () => {
      const current = readAnalyticsConsent(expectedUserId);
      return current
        ? JSON.stringify([
            current.version,
            current.serviceImprovement,
            current.sponsorMeasurement,
            current.updatedAt,
            current.syncPending,
          ])
        : null;
    };
    let localChoiceSnapshot = readLocalChoiceSnapshot();
    const markOwnChoiceWrite = () => {
      requestGeneration = consentMutationRef.current;
      localChoiceSnapshot = readLocalChoiceSnapshot();
    };
    const isCurrentAccount = () =>
      activeUserIdRef.current === expectedUserId &&
      consentMutationRef.current === requestGeneration &&
      readLocalChoiceSnapshot() === localChoiceSnapshot &&
      !controller.signal.aborted;

    try {
      const headers = new Headers({ 'X-Catho-Expected-User-Id': expectedUserId });
      let credentials: RequestCredentials = 'same-origin';
      if (getAccessToken) {
        const accessToken = await getAccessToken(expectedUserId);
        if (!isCurrentAccount()) return;
        if (!accessToken) {
          if (!readAnalyticsConsent(expectedUserId)) setVisible(false);
          return;
        }
        headers.set('Authorization', 'Bearer ' + accessToken);
        credentials = 'omit';
      }
      if (!isCurrentAccount()) return;

      // A native offline withdrawal is written to the encrypted consent cache
      // before its server update can run. Do not reconcile account analytics
      // against the old server personalisation grant until the native feed
      // has synchronised that pending denial and emits analyticsConsentSyncEvent.
      const hasPendingNativePersonalizationChange = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (pending: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(pending);
        };
        const timeout = window.setTimeout(() => finish(false), 300);
        window.dispatchEvent(new CustomEvent('cathoscroll:personalization-consent-status-request', {
          detail: {
            userId: expectedUserId,
            complete: (result: Promise<{
              available: boolean;
              consent: { enabled: boolean; pendingSync: boolean } | null;
            }>) => {
              void result.then(({ consent }) => finish(consent?.pendingSync === true)).catch(() => finish(false));
            },
          },
        }));
      });
      if (!isCurrentAccount() || hasPendingNativePersonalizationChange) return;

      const endpoint = apiBaseUrl
        ? new URL('/api/privacy/analytics-consent', apiBaseUrl).toString()
        : '/api/privacy/analytics-consent';
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials,
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
      if (!isCurrentAccount()) return;
      if (!response.ok) {
        if (!readAnalyticsConsent(expectedUserId)) setVisible(false);
        return;
      }
      const payload: unknown = await response.json();
      if (!isCurrentAccount()) return;
      if (typeof payload !== 'object' || payload === null || !('consent' in payload)) return;
      const remote = payload.consent as {
        serviceImprovement?: unknown;
        sponsorMeasurement?: unknown;
        updatedAt?: unknown;
        version?: unknown;
        exists?: unknown;
        personalizationEnabled?: unknown;
      };
      if (
        typeof remote.serviceImprovement !== 'boolean' ||
        typeof remote.sponsorMeasurement !== 'boolean' ||
        typeof remote.exists !== 'boolean' ||
        typeof remote.personalizationEnabled !== 'boolean' ||
        remote.version !== 1 ||
        !(remote.updatedAt === null || typeof remote.updatedAt === 'string')
      ) return;

      setPersonalizationEnabled(remote.personalizationEnabled);
      setPersonalizationStatusKnown(true);
      setPersonalizationStateUserId(expectedUserId);
      const local = readAnalyticsConsent(expectedUserId);
      if (local && (local.syncPending || !remote.exists)) {
        // Preserve the user's local denial. If the server confirms that
        // personalisation is still enabled, its consent rule rejects this
        // pending Service improvement withdrawal; never silently re-enable
        // local collection. The user can disable personalisation separately.
        const pendingChoices = {
          serviceImprovement: local.serviceImprovement,
          sponsorMeasurement: local.sponsorMeasurement,
        };
        const saveResponse = await fetch(endpoint, {
          method: 'POST',
          credentials,
          cache: 'no-store',
          headers: (() => {
            const nextHeaders = new Headers(headers);
            nextHeaders.set('Content-Type', 'application/json');
            return nextHeaders;
          })(),
          body: JSON.stringify({
            serviceImprovement: pendingChoices.serviceImprovement,
            sponsorMeasurement: pendingChoices.sponsorMeasurement,
            version: 1,
          }),
          signal: controller.signal,
        });
        if (!isCurrentAccount()) return;
        if (!saveResponse.ok) {
          console.warn('Analytics consent sync will retry when the device reconnects.');
          return;
        }
        const savedPayload: unknown = await saveResponse.json();
        if (!isCurrentAccount()) return;
        if (typeof savedPayload !== 'object' || savedPayload === null || !('consent' in savedPayload)) return;
        const saved = savedPayload.consent as {
          serviceImprovement?: unknown;
          sponsorMeasurement?: unknown;
          updatedAt?: unknown;
          version?: unknown;
          personalizationEnabled?: unknown;
        };
        if (
          typeof saved.serviceImprovement !== 'boolean' ||
          typeof saved.sponsorMeasurement !== 'boolean' ||
          typeof saved.personalizationEnabled !== 'boolean' ||
          saved.version !== 1 ||
          typeof saved.updatedAt !== 'string'
        ) return;
        setPersonalizationEnabled(saved.personalizationEnabled);
        setPersonalizationStatusKnown(true);
        setPersonalizationStateUserId(expectedUserId);
        const next = {
          serviceImprovement: saved.serviceImprovement,
          sponsorMeasurement: saved.sponsorMeasurement,
        };
        saveAnalyticsConsent(next, expectedUserId, {
          updatedAt: saved.updatedAt,
          syncPending: false,
        });
        markOwnChoiceWrite();
        hydrate({
          version: 1,
          ...next,
          updatedAt: saved.updatedAt,
          syncPending: false,
        });
        if (!managingRef.current) {
          setVisible(false);
          setManaging(false);
        }
        return;
      }

      if (remote.exists) {
        const next = {
          serviceImprovement: remote.serviceImprovement,
          sponsorMeasurement: remote.sponsorMeasurement,
        };
        const choicesChanged = !local ||
          local.serviceImprovement !== next.serviceImprovement ||
          local.sponsorMeasurement !== next.sponsorMeasurement;
        if (choicesChanged) {
          const interim = {
            serviceImprovement: local?.serviceImprovement === true && next.serviceImprovement,
            sponsorMeasurement: local?.sponsorMeasurement === true && next.sponsorMeasurement,
          };
          if (!interim.serviceImprovement) denyAnalyticsConsentInMemory('serviceImprovement', expectedUserId);
          if (!interim.sponsorMeasurement) denyAnalyticsConsentInMemory('sponsorMeasurement', expectedUserId);
          saveAnalyticsConsent(interim, expectedUserId, { syncPending: false });
          markOwnChoiceWrite();
          await clearWithdrawnQueues(local, next);
          if (!isCurrentAccount()) return;
        }
        const remoteUpdatedAt = typeof remote.updatedAt === 'string'
          ? remote.updatedAt
          : new Date().toISOString();
        saveAnalyticsConsent(next, expectedUserId, {
          updatedAt: remoteUpdatedAt,
          syncPending: false,
        });
        markOwnChoiceWrite();
        hydrate({
          version: 1,
          ...next,
          updatedAt: remoteUpdatedAt,
          syncPending: false,
        });
        if (!managingRef.current) {
          setVisible(false);
          setManaging(false);
        }
        return;
      }

      if (!local) setVisible(false);
    } catch (cause) {
      if (!isCurrentAccount()) return;
      console.warn('Analytics consent sync is deferred until connectivity is available:', cause);
      if (!readAnalyticsConsent(expectedUserId)) setVisible(false);
    } finally {
      if (syncAbortRef.current === controller) syncAbortRef.current = null;
    }
  }, [apiBaseUrl, clearWithdrawnQueues, getAccessToken, hydrate, loading, userId]);

  useEffect(() => {
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;
    return () => {
      syncAbortRef.current?.abort();
      syncAbortRef.current = null;
    };
  }, [loading, userId]);


  const save = useCallback(async (
    next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
  ) => {
    if (saving) return;
    const previous = readAnalyticsConsent(userId);
    const isServiceImprovementWithdrawal = previous?.serviceImprovement === true && !next.serviceImprovement;
    if (isServiceImprovementWithdrawal && effectivePersonalizationStatusKnown && effectivePersonalizationEnabled) {
      setError(effectivePersonalizationEnabled
        ? 'Turn off personalisation before disabling Service improvement analytics.'
        : 'Checking your personalisation settings. Try again in a moment.');
      return;
    }
    consentMutationRef.current += 1;
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;
    setSaving(true);
    setError('');
    try {
      // Apply every withdrawal immediately and keep every newly granted purpose
      // disabled until its pre-consent queue has been cleared.
      const interim = {
        serviceImprovement: previous?.serviceImprovement === true && next.serviceImprovement,
        sponsorMeasurement: previous?.sponsorMeasurement === true && next.sponsorMeasurement,
      };
      if (!interim.serviceImprovement) denyAnalyticsConsentInMemory('serviceImprovement', userId);
      if (!interim.sponsorMeasurement) denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      saveAnalyticsConsent(interim, userId, { syncPending: Boolean(userId) });
      await clearWithdrawnQueues(previous, next);
      saveAnalyticsConsent(next, userId);
      void syncServerConsent();
      managingRef.current = false;
      setVisible(false);
      setManaging(false);
    } catch (cause) {
      console.error('Unable to apply analytics preferences:', cause);
      setError('Your preference could not be fully saved or pending events could not be cleared. Optional analytics remain disabled until you retry.');
      try {
        denyAnalyticsConsentInMemory('serviceImprovement', userId);
      denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      saveAnalyticsConsent({ serviceImprovement: false, sponsorMeasurement: false }, userId);
      } catch {
        // Keep the modal open and fail closed in memory.
      }
      setServiceImprovement(false);
      setSponsorMeasurement(false);
    } finally {
      setSaving(false);
    }
  }, [clearWithdrawnQueues, effectivePersonalizationEnabled, effectivePersonalizationStatusKnown, saving, syncServerConsent, userId]);

  useEffect(() => {
    if (loading) return;

    // Retire old signed-out grants from the former consent popup. Optional
    // Service improvement and Sponsor measurement are account-only choices;
    // signed-out visitors have no optional analytics collection or controls.
    const legacySignedOutConsent = readAnalyticsConsent(null);
    if (legacySignedOutConsent?.serviceImprovement || legacySignedOutConsent?.sponsorMeasurement) {
      denyAnalyticsConsentInMemory('serviceImprovement', null);
      denyAnalyticsConsentInMemory('sponsorMeasurement', null);
      try {
        saveAnalyticsConsent({ serviceImprovement: false, sponsorMeasurement: false }, null, { syncPending: false });
      } catch (cause) {
        console.error('Unable to clear legacy signed-out analytics choices:', cause);
      }
    }

    const existing = readAnalyticsConsent(userId);
    const hydrationTimer = window.setTimeout(() => {
      hydrate(existing);
      if (!existing && !userId) setVisible(false);
    }, 0);
    if (!existing) {
      // Existing pre-consent queues must not be uploaded after this update.
      void clearWithdrawnQueues(null, { serviceImprovement: false, sponsorMeasurement: false });
    } else {
      // On native, the account can hydrate after this manager first mounts.
      // Re-run the disabled-stream cleanup when that identity becomes known.
      const tasks: Promise<unknown>[] = [];
      if (!existing.serviceImprovement) {
        if (userId) {
          tasks.push(clearFeedAnalyticsOutbox(userId));
          tasks.push(clearFeedCardAnalyticsOutbox(userId));
        }
      }
      if (!existing.sponsorMeasurement) {
        if (userId) tasks.push(clearSponsorAnalyticsOutbox(userId));
      }
      void Promise.all(tasks).catch((cause) => {
        console.error('Unable to clear disabled analytics queues:', cause);
      });
    }
    const manage = () => {
      hydrate(readAnalyticsConsent(userId));
      managingRef.current = true;
      setManaging(true);
      setVisible(false);
      void syncServerConsent();
    };
    window.addEventListener(analyticsConsentManageEvent, manage);
    return () => {
      window.clearTimeout(hydrationTimer);
      window.removeEventListener(analyticsConsentManageEvent, manage);
    };
  }, [clearWithdrawnQueues, hydrate, loading, syncServerConsent, userId]);

  useEffect(() => {
    const onConsentChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if ((detail?.userId ?? null) === userId) consentMutationRef.current += 1;
    };
    const storageKey = getAnalyticsConsentStorageKey(userId);
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) consentMutationRef.current += 1;
    };
    window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
    window.addEventListener('storage', onStorageChange);
    return () => {
      window.removeEventListener(analyticsConsentChangeEvent, onConsentChange);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [userId]);

  useEffect(() => {
    if (loading) return;
    const syncTimer = window.setTimeout(() => {
      void syncServerConsent();
    }, 0);
    window.addEventListener('online', syncServerConsent);
    window.addEventListener(analyticsConsentSyncEvent, syncServerConsent);
    return () => {
      window.clearTimeout(syncTimer);
      window.removeEventListener('online', syncServerConsent);
      window.removeEventListener(analyticsConsentSyncEvent, syncServerConsent);
    };
  }, [loading, syncServerConsent]);

  if (loading || !visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6" role="presentation">
      <section
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        ref={dialogRef}
        className={`bg-bg-card border-border w-full overflow-y-auto rounded-2xl border shadow-2xl ${managing ? 'max-h-[min(90vh,760px)] max-w-xl p-6 sm:p-8' : 'max-h-[min(75vh,420px)] max-w-md p-4 sm:p-5'}`}
      >
        <p className="text-accent text-xs font-bold tracking-[0.16em] uppercase">Your privacy</p>
        <h2 id="analytics-consent-title" className={`text-text-primary mt-2 font-bold ${managing ? 'text-2xl' : 'text-xl'}`}>
          {managing ? 'Manage analytics choices' : 'Help improve CathoScroll'}
        </h2>
        <p id="analytics-consent-description" className="text-text-secondary mt-3 text-sm leading-relaxed">
          {managing
            ? 'Choose optional analytics. Service improvement analytics is required while personalisation is enabled; sponsor measurement remains separate.'
            : effectivePersonalizationEnabled
              ? 'Personalisation is on, so Service improvement analytics is required. Turn off personalisation before disabling it.'
              : 'Optional analytics measure signed-in topic/comment engagement and sponsor viewability, clicks and frequency. Catholic-content activity may reveal religious or philosophical beliefs. Personalisation uses eligible reading signals for private recommendations. Sponsor placements remain visible when measurement is off; no delivery or anonymous engagement counters are retained.'}
        </p>

        {!managing ? (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save({ serviceImprovement: true, sponsorMeasurement: true })}
              className="bg-accent hover:bg-accent/90 w-full rounded-xl px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Accept all'}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={saving || effectivePersonalizationEnabled}
                onClick={() => void save({ serviceImprovement: false, sponsorMeasurement: false })}
                className="border-border text-text-primary hover:bg-bg-secondary rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Decline optional
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { managingRef.current = true; setManaging(true); }}
                className="border-border text-text-primary hover:bg-bg-secondary rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Manage choices
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-4">
              <input
                type="checkbox"
                checked={serviceImprovement}
                disabled={saving || effectivePersonalizationEnabled || (!effectivePersonalizationStatusKnown && !serviceImprovement)}
                onChange={(event) => setServiceImprovement(event.target.checked)}
                className="accent-accent mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-text-primary block font-semibold">I explicitly agree to Service improvement analytics</span>
                <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
                  Measures signed-in topic and Top Comments engagement plus Vercel site/performance analytics. Account-linked activity may reveal religious or philosophical beliefs. While personalisation is enabled, reading signals also inform your private recommendations. Enabling personalisation automatically enables this choice; turn it off before disabling this choice.
                </span>
                {effectivePersonalizationEnabled && <span className="text-accent mt-2 block text-xs font-semibold">Required while personalisation is enabled — Turn off personalisation first to disable this choice.</span>}
              </span>
            </label>
            <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-4">
              <input
                type="checkbox"
                checked={sponsorMeasurement}
                disabled={saving}
                onChange={(event) => setSponsorMeasurement(event.target.checked)}
                className="accent-accent mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-text-primary block font-semibold">I explicitly agree to Sponsor measurement</span>
                <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
                  Measures sponsor viewability, clicks and frequency only for signed-in users who explicitly opt in. Events are account-linked and may reveal religious or philosophical interests. If you decline, sponsor placements still appear, but no sponsor engagement or delivery counters are retained.
                </span>
              </span>
            </label>
            <p className="text-text-muted text-xs leading-relaxed">
              Essential operation, sign-in, account synchronisation, bookmarks, likes, progress, notes and general feed ranking continue regardless of these choices. Personalisation requires Service improvement analytics; Sponsor measurement remains independent.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => { managingRef.current = false; setManaging(false); }}
                className="border-border text-text-primary rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save({ serviceImprovement, sponsorMeasurement })}
                className="bg-accent rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save choices'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-destructive mt-4 text-sm" role="alert">{error}</p>}
      </section>
    </div>
  );
}

export function AnalyticsConsentSettingsButton() {
  return (
    <Link href="/account#analytics-choices" className="text-accent underline underline-offset-4 hover:no-underline">
      Manage analytics choices in Account settings
    </Link>
  );
}

