'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  analyticsConsentChangeEvent,
  analyticsConsentSyncEvent,
  denyAnalyticsConsentInMemory,
  getAnalyticsConsentStorageKey,
  readAnalyticsConsent,
  saveAnalyticsConsent,
} from '@/lib/analytics-consent';
import { clearAnalyticsConsentQueues } from '@/components/privacy/AnalyticsConsentManager';

type AnalyticsConsentSettingsPanelProps = {
  userId: string | null;
  personalizationEnabled: boolean;
  personalizationStatusKnown: boolean;
  offlineCacheAvailable: boolean;
  disabled?: boolean;
};

async function persistOfflinePersonalizationWithdrawal(userId: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Offline personalisation storage is unavailable.');
  }
  let cacheWrite: Promise<void> | null = null;
  window.dispatchEvent(new CustomEvent('cathoscroll:personalization-consent-changed', {
    detail: {
      userId,
      enabled: false,
      pendingSync: true,
      complete: (result: Promise<void>) => { cacheWrite = result; },
    },
  }));
  if (!cacheWrite) {
    throw new Error('The native personalisation cache did not accept the offline withdrawal.');
  }
  await cacheWrite;
}

export function AnalyticsConsentSettingsPanel({
  userId,
  personalizationEnabled,
  personalizationStatusKnown,
  offlineCacheAvailable,
  disabled = false,
}: AnalyticsConsentSettingsPanelProps) {
  const [serviceImprovement, setServiceImprovement] = useState(false);
  const [sponsorMeasurement, setSponsorMeasurement] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hydrate = useCallback(() => {
    const consent = readAnalyticsConsent(userId);
    setServiceImprovement(personalizationEnabled || consent?.serviceImprovement === true);
    setSponsorMeasurement(consent?.sponsorMeasurement === true);
  }, [personalizationEnabled, userId]);

  useEffect(() => {
    hydrate();
    const onConsentChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if ((detail?.userId ?? null) === userId) hydrate();
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === getAnalyticsConsentStorageKey(userId)) hydrate();
    };
    window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
    window.addEventListener('storage', onStorageChange);
    return () => {
      window.removeEventListener(analyticsConsentChangeEvent, onConsentChange);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [hydrate, userId]);

  async function saveChoices() {
    if (saving || disabled || !userId) return;
    const previous = readAnalyticsConsent(userId);
    const offlinePersonalizationWithdrawal =
      !personalizationStatusKnown &&
      offlineCacheAvailable &&
      typeof navigator !== 'undefined' &&
      !navigator.onLine &&
      previous?.serviceImprovement === true &&
      !serviceImprovement;
    const next = {
      serviceImprovement: personalizationStatusKnown
        ? personalizationEnabled || serviceImprovement
        : offlinePersonalizationWithdrawal
          ? false
          : previous?.serviceImprovement === true,
      sponsorMeasurement,
    };
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (offlinePersonalizationWithdrawal) {
        // The server may still report personalisation as enabled. Persist a
        // local personalisation denial first so the linked analytics denial
        // cannot be overwritten before the native cache syncs on reconnect.
        await persistOfflinePersonalizationWithdrawal(userId);
      }
      const interim = {
        serviceImprovement: personalizationEnabled || (previous?.serviceImprovement === true && next.serviceImprovement),
        sponsorMeasurement: previous?.sponsorMeasurement === true && next.sponsorMeasurement,
      };
      if (!interim.serviceImprovement) denyAnalyticsConsentInMemory('serviceImprovement', userId);
      if (!interim.sponsorMeasurement) denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      saveAnalyticsConsent(interim, userId, { syncPending: true });
      await clearAnalyticsConsentQueues(userId, previous, next);
      saveAnalyticsConsent(next, userId, { syncPending: true });
      setServiceImprovement(next.serviceImprovement);
      setSponsorMeasurement(next.sponsorMeasurement);
      window.dispatchEvent(new Event(analyticsConsentSyncEvent));
      setMessage(navigator.onLine
        ? 'Saved. Your account settings are synchronising.'
        : 'Saved on this device. Your account settings will synchronise when you reconnect.');
    } catch (cause) {
      console.error('Unable to save analytics settings:', cause);
      denyAnalyticsConsentInMemory('serviceImprovement', userId);
      denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      try {
        saveAnalyticsConsent({ serviceImprovement: false, sponsorMeasurement: false }, userId, { syncPending: true });
      } catch {
        // In-memory denials remain active if local storage is unavailable.
      }
      setServiceImprovement(false);
      setSponsorMeasurement(false);
      setError('Could not safely save these settings. Optional analytics remain disabled on this device.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="analytics-choices" className="border-border mt-6 scroll-mt-8 border-t pt-5">
      <h3 className="font-semibold">Analytics choices</h3>
      <p className="text-text-muted mt-1 text-sm leading-relaxed">
        Optional. Change these settings at any time. Sponsor delivery is unaffected.
      </p>

      <div className="mt-4 space-y-3">
        <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-4">
          <input
            type="checkbox"
            checked={personalizationEnabled || serviceImprovement}
            disabled={disabled || saving || personalizationEnabled || (!personalizationStatusKnown && !(offlineCacheAvailable && typeof navigator !== 'undefined' && !navigator.onLine && serviceImprovement))}
            onChange={(event) => setServiceImprovement(event.target.checked)}
            className="accent-accent mt-1 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-semibold">I explicitly consent to Service improvement analytics</span>
            <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
              Measures account-linked topic/comment engagement and site performance. Activity may reveal religious or philosophical interests.
            </span>
            {!personalizationStatusKnown && (
              <span className="text-text-muted mt-2 block text-xs">Personalisation status is unavailable. While offline, you can withdraw this choice locally; personalisation will also be disabled on this device and both changes will synchronise when you reconnect. Sponsor measurement can still be changed.</span>
            )}
            {personalizationEnabled && (
              <span className="text-accent mt-2 block text-xs font-semibold">
                Required while personalisation is on. Turn personalisation off first to disable this.
              </span>
            )}
          </span>
        </label>

        <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-4">
          <input
            type="checkbox"
            checked={sponsorMeasurement}
            disabled={disabled || saving}
            onChange={(event) => setSponsorMeasurement(event.target.checked)}
            className="accent-accent mt-1 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-semibold">I explicitly consent to Sponsor measurement</span>
            <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
              Measures account-linked sponsor viewability, clicks and frequency. Placement context may reveal religious or philosophical interests. Sponsor placements still appear when this is off.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-muted text-xs">
          Personalisation automatically enables Service improvement analytics. Sponsor measurement is separate and never affects recommendations.
        </p>
        <button
          type="button"
          disabled={disabled || saving || !userId}
          onClick={() => void saveChoices()}
          className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save analytics choices'}
        </button>
      </div>

      {error && <p className="text-destructive mt-3 text-sm" role="alert">{error}</p>}
      {message && <p className="text-text-muted mt-3 text-sm" role="status">{message}</p>}
    </section>
  );
}
