'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  analyticsConsentManageEvent,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  type AnalyticsConsent,
} from '@/lib/analytics-consent';
import { setAnonymousFeedAnalyticsEnabled } from '@/lib/anonymous-feed-analytics-client';
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

type AnalyticsConsentManagerProps = {
  userId?: string | null;
  apiBaseUrl?: string;
  getAccessToken?: () => Promise<string | null>;
};

export function AnalyticsConsentManager({ userId = null, apiBaseUrl, getAccessToken }: AnalyticsConsentManagerProps = {}) {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [serviceImprovement, setServiceImprovement] = useState(false);
  const [sponsorMeasurement, setSponsorMeasurement] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hydrate = useCallback((consent: AnalyticsConsent | null) => {
    setServiceImprovement(consent?.serviceImprovement ?? false);
    setSponsorMeasurement(consent?.sponsorMeasurement ?? false);
  }, []);

  const clearWithdrawnQueues = useCallback(async (
    previous: AnalyticsConsent | null,
    next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
  ) => {
    const clearService = previous === null || previous.serviceImprovement !== next.serviceImprovement;
    const clearSponsor = previous === null || previous.sponsorMeasurement !== next.sponsorMeasurement;
    const tasks: Promise<unknown>[] = [];
    if (clearService) {
      if (userId) {
        tasks.push(clearFeedAnalyticsOutbox(userId));
        tasks.push(clearFeedCardAnalyticsOutbox(userId));
      }
      else tasks.push(setAnonymousFeedAnalyticsEnabled(false));
    }
    if (clearSponsor) {
      if (userId) tasks.push(clearSponsorAnalyticsOutbox(userId));
      tasks.push(Promise.resolve(clearAnonymousSponsorAnalyticsQueue()));
    }
    await Promise.all(tasks);
  }, [userId]);

  const syncServerConsent = useCallback(async () => {
    if (!userId || typeof window === 'undefined') return;
    try {
      const headers = new Headers();
      let credentials: RequestCredentials = 'same-origin';
      if (getAccessToken) {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          if (!readAnalyticsConsent(userId)) setVisible(true);
          return;
        }
        headers.set('Authorization', 'Bearer ' + accessToken);
        credentials = 'omit';
      }
      const endpoint = apiBaseUrl
        ? new URL('/api/privacy/analytics-consent', apiBaseUrl).toString()
        : '/api/privacy/analytics-consent';
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials,
        cache: 'no-store',
        headers,
      });
      if (!response.ok) {
        if (!readAnalyticsConsent(userId)) setVisible(true);
        return;
      }
      const payload: unknown = await response.json();
      if (typeof payload !== 'object' || payload === null || !('consent' in payload)) return;
      const remote = payload.consent as {
        serviceImprovement?: unknown;
        sponsorMeasurement?: unknown;
        updatedAt?: unknown;
        version?: unknown;
        exists?: unknown;
      };
      if (
        typeof remote.serviceImprovement !== 'boolean' ||
        typeof remote.sponsorMeasurement !== 'boolean' ||
        typeof remote.exists !== 'boolean' ||
        remote.version !== 1 ||
        !(remote.updatedAt === null || typeof remote.updatedAt === 'string')
      ) return;

      const local = readAnalyticsConsent(userId);
      if (!remote.exists && !local) setVisible(true);
      const remoteIsNewer = remote.exists && typeof remote.updatedAt === 'string' &&
        (!local || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt));
      if (remoteIsNewer || (!local && remote.exists)) {
        const next = {
          serviceImprovement: remote.serviceImprovement,
          sponsorMeasurement: remote.sponsorMeasurement,
        };
        const choicesChanged = !local ||
          local.serviceImprovement !== next.serviceImprovement ||
          local.sponsorMeasurement !== next.sponsorMeasurement;
        if (choicesChanged) await clearWithdrawnQueues(local, next);
        saveAnalyticsConsent(next, userId);
        hydrate({
          version: 1,
          ...next,
          updatedAt: remote.updatedAt as string,
        });
        setVisible(false);
        setManaging(false);
        return;
      }

      if (local && (!remote.exists || !remote.updatedAt || Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt))) {
        const saveResponse = await fetch(endpoint, {
          method: 'POST',
          credentials,
          cache: 'no-store',
          headers: (() => { const nextHeaders = new Headers(headers); nextHeaders.set('Content-Type', 'application/json'); return nextHeaders; })(),
          body: JSON.stringify({
            serviceImprovement: local.serviceImprovement,
            sponsorMeasurement: local.sponsorMeasurement,
            version: 1,
          }),
        });
        if (!saveResponse.ok) {
          console.warn('Analytics consent sync will retry when the device reconnects.');
        }
      }
    } catch (cause) {
      console.warn('Analytics consent sync is deferred until connectivity is available:', cause);
      if (!readAnalyticsConsent(userId)) setVisible(true);
    }
  }, [apiBaseUrl, clearWithdrawnQueues, getAccessToken, hydrate, userId]);

  const save = useCallback(async (
    next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
  ) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const previous = readAnalyticsConsent(userId);
      // Apply every withdrawal immediately and keep every newly granted purpose
      // disabled until its pre-consent queue has been cleared.
      const interim = {
        serviceImprovement: previous?.serviceImprovement === true && next.serviceImprovement,
        sponsorMeasurement: previous?.sponsorMeasurement === true && next.sponsorMeasurement,
      };
      saveAnalyticsConsent(interim, userId);
      await clearWithdrawnQueues(previous, next);
      saveAnalyticsConsent(next, userId);
      void syncServerConsent();
      setVisible(false);
      setManaging(false);
    } catch (cause) {
      console.error('Unable to apply analytics preferences:', cause);
      setError('Your preference could not be fully saved or pending events could not be cleared. Optional analytics remain disabled until you retry.');
      try {
        saveAnalyticsConsent({ serviceImprovement: false, sponsorMeasurement: false }, userId);
      } catch {
        // Keep the modal open and fail closed in memory.
      }
      setServiceImprovement(false);
      setSponsorMeasurement(false);
    } finally {
      setSaving(false);
    }
  }, [clearWithdrawnQueues, saving, syncServerConsent, userId]);

  useEffect(() => {
    const existing = readAnalyticsConsent(userId);
    hydrate(existing);
    if (!existing) {
      if (!userId) setVisible(true);
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
        else tasks.push(setAnonymousFeedAnalyticsEnabled(false));
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
      setManaging(true);
      setVisible(true);
    };
    window.addEventListener(analyticsConsentManageEvent, manage);
    return () => window.removeEventListener(analyticsConsentManageEvent, manage);
  }, [clearWithdrawnQueues, hydrate, userId]);

  useEffect(() => {
    void syncServerConsent();
    window.addEventListener('online', syncServerConsent);
    return () => window.removeEventListener('online', syncServerConsent);
  }, [syncServerConsent]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6" role="presentation">
      <section
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
        aria-modal="true"
        role="dialog"
        className="bg-bg-card border-border max-h-[min(90vh,760px)] w-full max-w-xl overflow-y-auto rounded-2xl border p-6 shadow-2xl sm:p-8"
      >
        <p className="text-accent text-xs font-bold tracking-[0.16em] uppercase">Your privacy</p>
        <h2 id="analytics-consent-title" className="text-text-primary mt-2 text-2xl font-bold">
          {managing ? 'Manage analytics choices' : 'Help improve CathoScroll'}
        </h2>
        <p id="analytics-consent-description" className="text-text-secondary mt-3 text-sm leading-relaxed">
          {managing
            ? 'Choose which optional analytics CathoScroll may collect. Both choices are optional and start off unless you have already enabled them.'
            : 'You can allow optional analytics to improve CathoScroll and measure sponsor performance. Service improvement analytics may involve engagement with Catholic topics and comments, which can reveal religious or philosophical interests. Accept all includes your explicit agreement to both purposes; you can reject both or manage each choice separately.'}
        </p>

        {!managing ? (
          <div className="mt-7 space-y-3">
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
                disabled={saving}
                onClick={() => void save({ serviceImprovement: false, sponsorMeasurement: false })}
                className="border-border text-text-primary hover:bg-bg-secondary rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Decline optional
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setManaging(true)}
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
                disabled={saving}
                onChange={(event) => setServiceImprovement(event.target.checked)}
                className="accent-accent mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-text-primary block font-semibold">I explicitly agree to Service improvement analytics</span>
                <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
                  Measures topic and Top Comments engagement, signed-out aggregate activity, and Vercel site/performance analytics. When signed in, topic/comment activity is linked to your account and may reveal religious or philosophical beliefs; enabling this choice is your explicit consent to that limited service-improvement processing, which may involve special-category data under UK GDPR. It is not used for recommendation personalisation.
                </span>
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
                <span className="text-text-primary block font-semibold">Sponsor measurement</span>
                <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
                  Measures sponsor viewability, clicks and frequency. If you decline, sponsor placements still appear. We retain campaign/day served totals for campaign delivery and pacing, but do not create visitor/session frequency records or viewability/click events for your visit.
                </span>
              </span>
            </label>
            <p className="text-text-muted text-xs leading-relaxed">
              Essential operation, sign-in, account synchronisation, bookmarks, likes, progress, notes and general feed ranking continue regardless of these choices. Recommendation personalisation remains controlled separately in signup and Account settings.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => setManaging(false)}
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

