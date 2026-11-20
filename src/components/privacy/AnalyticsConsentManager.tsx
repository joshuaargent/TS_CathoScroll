'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
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

type AnalyticsConsentManagerProps = { userId?: string | null };

function ConsentManager({ userId = null }: AnalyticsConsentManagerProps) {
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
      tasks.push(setAnonymousFeedAnalyticsEnabled(false));
    }
    if (clearSponsor) {
      if (userId) tasks.push(clearSponsorAnalyticsOutbox(userId));
      tasks.push(Promise.resolve(clearAnonymousSponsorAnalyticsQueue()));
    }
    await Promise.all(tasks);
  }, [userId]);

  const save = useCallback(async (
    next: Pick<AnalyticsConsent, 'serviceImprovement' | 'sponsorMeasurement'>
  ) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const previous = readAnalyticsConsent();
      // Clear old events before granting again. A fresh opt-in must never
      // revive events queued before the user made the new choice.
      await clearWithdrawnQueues(previous, next);
      saveAnalyticsConsent(next);
      if (next.serviceImprovement) await setAnonymousFeedAnalyticsEnabled(true);
      setVisible(false);
      setManaging(false);
    } catch (cause) {
      console.error('Unable to apply analytics preferences:', cause);
      setError('Your preference could not be fully saved or pending events could not be cleared. Optional analytics remain disabled until you retry.');
      try {
        saveAnalyticsConsent({ serviceImprovement: false, sponsorMeasurement: false });
      } catch {
        // Keep the modal open and fail closed in memory.
      }
      setServiceImprovement(false);
      setSponsorMeasurement(false);
    } finally {
      setSaving(false);
    }
  }, [clearWithdrawnQueues, saving]);

  useEffect(() => {
    const existing = readAnalyticsConsent();
    hydrate(existing);
    if (!existing) {
      setVisible(true);
      // Existing pre-consent queues must not be uploaded after this update.
      void clearWithdrawnQueues(null, { serviceImprovement: false, sponsorMeasurement: false });
    }
    const manage = () => {
      hydrate(readAnalyticsConsent());
      setManaging(true);
      setVisible(true);
    };
    window.addEventListener(analyticsConsentManageEvent, manage);
    return () => window.removeEventListener(analyticsConsentManageEvent, manage);
  }, [clearWithdrawnQueues, hydrate]);

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
            : 'You can allow optional analytics to help us improve the service and understand sponsor performance. You can reject both or manage each choice separately.'}
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
                <span className="text-text-primary block font-semibold">Service improvement analytics</span>
                <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
                  Measures topic and Top Comments engagement, including account-linked activity when signed in, signed-out aggregate activity, and Vercel site/performance analytics. Topic activity in a Catholic-content service may reveal or allow inferences about religious or philosophical beliefs. This is separate from recommendation personalisation.
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
                  Measures sponsor viewability, clicks and frequency. If you decline, sponsor placements can still appear; we keep only campaign/day served totals and do not create visitor/session frequency records or client viewability/click events for your visit.
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


export function AnalyticsConsentManager() {
  const { user } = useAuth();
  return <ConsentManager userId={user?.id ?? null} />;
}

export function NativeAnalyticsConsentManager({ userId }: AnalyticsConsentManagerProps) {
  return <ConsentManager userId={userId ?? null} />;
}
