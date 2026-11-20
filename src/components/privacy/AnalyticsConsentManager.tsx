'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  isAnonymousFeedAnalyticsEnabled,
  setAnonymousFeedAnalyticsEnabled,
  anonymousAnalyticsPreferenceChangeEvent,
} from '@/lib/anonymous-feed-analytics-client';
import {
  clearAnonymousSponsorAnalyticsQueue,
  clearSponsorAnalyticsOutbox,
} from '@/lib/sponsor-analytics-client';
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
    tasks.push(Promise.resolve(clearAnonymousSponsorAnalyticsQueue()));
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
  const [anonymousAggregateEnabled, setAnonymousAggregateEnabled] = useState(true);
  const [anonymousAggregateSaving, setAnonymousAggregateSaving] = useState(false);
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
    const refreshAnonymousChoice = () => setAnonymousAggregateEnabled(isAnonymousFeedAnalyticsEnabled());
    refreshAnonymousChoice();
    window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, refreshAnonymousChoice);
    return () => window.removeEventListener(anonymousAnalyticsPreferenceChangeEvent, refreshAnonymousChoice);
  }, []);

  useEffect(() => {
    activeUserIdRef.current = userId;
    setPersonalizationEnabled(false);
    setPersonalizationStatusKnown(!userId);
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
          if (!readAnalyticsConsent(expectedUserId)) setVisible(true);
          return;
        }
        headers.set('Authorization', 'Bearer ' + accessToken);
        credentials = 'omit';
      }
      if (!isCurrentAccount()) return;
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
        if (!readAnalyticsConsent(expectedUserId)) setVisible(true);
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
        // Personalisation requires Service improvement analytics, but a pending
        // Sponsor measurement withdrawal is still independent and must sync.
        const pendingChoices = {
          serviceImprovement: remote.personalizationEnabled ? true : local.serviceImprovement,
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

      if (!local) setVisible(true);
    } catch (cause) {
      if (!isCurrentAccount()) return;
      console.warn('Analytics consent sync is deferred until connectivity is available:', cause);
      if (!readAnalyticsConsent(expectedUserId)) setVisible(true);
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
    if (isServiceImprovementWithdrawal && (!effectivePersonalizationStatusKnown || effectivePersonalizationEnabled)) {
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
    const existing = readAnalyticsConsent(userId);
    const hydrationTimer = window.setTimeout(() => {
      hydrate(existing);
      if (!existing && !userId) setVisible(true);
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
        tasks.push(Promise.resolve(clearAnonymousSponsorAnalyticsQueue()));
      }
      void Promise.all(tasks).catch((cause) => {
        console.error('Unable to clear disabled analytics queues:', cause);
      });
    }
    const manage = () => {
      hydrate(readAnalyticsConsent(userId));
      managingRef.current = true;
      setManaging(true);
      setVisible(true);
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
              : 'Accept all enables account-linked topic/comment reading measurement and sponsor view, click, frequency and placement measurement. Catholic-content activity may reveal religious or philosophical beliefs. Enabling personalisation also enables Service improvement analytics and reading-signal recommendations. Signed-out activity is counted in daily aggregates by default; you can object in Manage choices.'}
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
                disabled={saving || effectivePersonalizationEnabled || !effectivePersonalizationStatusKnown}
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
                disabled={saving || effectivePersonalizationEnabled || !effectivePersonalizationStatusKnown}
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
                  Measures sponsor viewability, clicks and frequency. When enabled, signed-in events are account-linked; signed-out frequency uses a random in-memory session token whose hash is stored for up to 30 days. Anonymous event attribution can include the topic placement where a sponsor appeared. In a Catholic-content service, that context may reveal religious or philosophical interests and may involve special-category data under UK GDPR. If you decline, sponsor placements still appear and we retain only campaign/day served totals, without visitor/session frequency records or viewability/click events for your visit.
                </span>
              </span>
            </label>
            <div className="border-border rounded-xl border p-4">
              <p className="text-text-primary text-sm font-semibold">Signed-out aggregate measurement</p>
              <p className="text-text-secondary mt-1 text-sm leading-relaxed">
                By default, signed-out topic and comment activity is counted as daily totals without account, visitor or session identifiers. This is separate from optional account-linked analytics and does not create individual profiles. You can object at any time.
              </p>
              <button
                type="button"
                disabled={saving || anonymousAggregateSaving}
                onClick={() => {
                  const next = !anonymousAggregateEnabled;
                  setAnonymousAggregateSaving(true);
                  void setAnonymousFeedAnalyticsEnabled(next).then(() => setAnonymousAggregateEnabled(next)).catch(() => {
                    setError('Your anonymous aggregate measurement preference could not be saved.');
                  }).finally(() => setAnonymousAggregateSaving(false));
                }}
                className="text-accent mt-2 text-sm font-semibold underline underline-offset-2 disabled:opacity-50"
              >
                {anonymousAggregateEnabled ? 'Turn off anonymous aggregate measurement' : 'Turn on anonymous aggregate measurement'}
              </button>
            </div>
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
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event(analyticsConsentManageEvent));
        }
      }}
      className="text-accent underline underline-offset-4 hover:no-underline"
    >
      Manage analytics choices
    </button>
  );
}

