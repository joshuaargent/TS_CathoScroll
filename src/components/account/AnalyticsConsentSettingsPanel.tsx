'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  analyticsConsentChangeEvent,
  analyticsConsentSyncEvent,
  denyAnalyticsConsentInMemory,
  getAnalyticsConsentStorageKey,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  type AnalyticsConsentChoice,
} from '@/lib/analytics-consent';
import { clearAnalyticsConsentQueues } from '@/components/privacy/AnalyticsConsentManager';

type AnalyticsConsentSettingsPanelProps = {
  userId: string | null;
  disabled?: boolean;
  personalizationStatusKnown: boolean;
  personalizationEnabled: boolean;
};

export function AnalyticsConsentSettingsPanel({
  userId,
  disabled = false,
  personalizationStatusKnown,
  personalizationEnabled,
}: AnalyticsConsentSettingsPanelProps) {
  const [serviceImprovement, setServiceImprovement] = useState(false);
  const [sponsorMeasurement, setSponsorMeasurement] = useState(false);
  const [changedPurposes, setChangedPurposes] = useState<AnalyticsConsentChoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hydrate = useCallback(() => {
    const consent = readAnalyticsConsent(userId);
    setServiceImprovement(personalizationEnabled || consent?.serviceImprovement === true);
    setSponsorMeasurement(consent?.sponsorMeasurement === true);
    setChangedPurposes(consent?.syncPending ? consent.pendingPurposes : []);
  }, [personalizationEnabled, userId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) hydrate();
    });
    const onConsentChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if (active && (detail?.userId ?? null) === userId) hydrate();
    };
    const onConsentSync = () => {
      if (active && readAnalyticsConsent(userId)?.syncPending !== true) hydrate();
    };
    const onStorageChange = (event: StorageEvent) => {
      if (active && event.key === getAnalyticsConsentStorageKey(userId)) hydrate();
    };
    window.addEventListener(analyticsConsentChangeEvent, onConsentChange);
    window.addEventListener(analyticsConsentSyncEvent, onConsentSync);
    window.addEventListener('storage', onStorageChange);
    return () => {
      active = false;
      window.removeEventListener(analyticsConsentChangeEvent, onConsentChange);
      window.removeEventListener(analyticsConsentSyncEvent, onConsentSync);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [hydrate, userId]);

  async function saveChoices() {
    if (saving || !userId) return;
    const previous = readAnalyticsConsent(userId);
    const pendingPurposeSet = new Set<AnalyticsConsentChoice>(previous?.pendingPurposes ?? []);
    for (const purpose of changedPurposes) pendingPurposeSet.add(purpose);
    const pendingPurposes = Array.from(pendingPurposeSet);
    if (pendingPurposes.length === 0) return;
    const nextServiceImprovement = !personalizationStatusKnown
      ? previous?.serviceImprovement === true
      : personalizationEnabled || serviceImprovement;
    const next = { serviceImprovement: nextServiceImprovement, sponsorMeasurement };
    const interim = {
      serviceImprovement: previous?.serviceImprovement === true && next.serviceImprovement,
      sponsorMeasurement: previous?.sponsorMeasurement === true && next.sponsorMeasurement,
    };
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (!interim.serviceImprovement) denyAnalyticsConsentInMemory('serviceImprovement', userId);
      if (!interim.sponsorMeasurement) denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      saveAnalyticsConsent(interim, userId, { syncPending: true, pendingPurposes });
      await clearAnalyticsConsentQueues(userId, previous, next);
      saveAnalyticsConsent(next, userId, { syncPending: true, pendingPurposes });
      setChangedPurposes([]);
      window.dispatchEvent(new Event(analyticsConsentSyncEvent));
      setMessage(typeof navigator !== 'undefined' && navigator.onLine
        ? 'Saved. Your account settings are synchronising.'
        : 'Saved on this device. Your account settings will synchronise when you reconnect.');
    } catch (cause) {
      console.error('Unable to save analytics settings:', cause);
      const safeServiceImprovement = personalizationEnabled
        || (previous?.serviceImprovement === true && (!personalizationStatusKnown || serviceImprovement));
      const safeSponsorMeasurement = previous?.sponsorMeasurement === true && sponsorMeasurement;
      if (!safeServiceImprovement) denyAnalyticsConsentInMemory('serviceImprovement', userId);
      if (!safeSponsorMeasurement) denyAnalyticsConsentInMemory('sponsorMeasurement', userId);
      let denialPersisted = false;
      try {
        if (personalizationStatusKnown || previous) {
          saveAnalyticsConsent({
            serviceImprovement: safeServiceImprovement,
            sponsorMeasurement: safeSponsorMeasurement,
          }, userId, { syncPending: true, pendingPurposes });
          denialPersisted = true;
        }
      } catch {
        // Existing grants are preserved only when they were not withdrawn;
        // in-memory denials remain active for withdrawn or ungranted streams.
      }
      if (denialPersisted) window.dispatchEvent(new Event(analyticsConsentSyncEvent));
      if (personalizationStatusKnown || previous) setServiceImprovement(safeServiceImprovement);
      setSponsorMeasurement(safeSponsorMeasurement);
      setError('Changes could not be saved. Withdrawals are applied locally; new grants were not activated.');
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
            checked={serviceImprovement}
            disabled={disabled || saving || !personalizationStatusKnown || personalizationEnabled}
            onChange={(event) => {
              setServiceImprovement(event.target.checked);
              setChangedPurposes((current) => current.includes('serviceImprovement') ? current : [...current, 'serviceImprovement']);
            }}
            className="accent-accent mt-1 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-semibold">I explicitly consent to Service improvement analytics</span>
            <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
              Measures account-linked topic/comment engagement and site performance. Activity may reveal religious or philosophical interests. This choice must remain enabled while Personalisation is active; turn off Personalisation first to withdraw it. Passive reading signals inform recommendations while Personalisation is enabled.
            </span>
          </span>
        </label>

        <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-4">
          <input
            type="checkbox"
            checked={sponsorMeasurement}
            disabled={disabled || saving}
            onChange={(event) => {
              setSponsorMeasurement(event.target.checked);
              setChangedPurposes((current) => current.includes('sponsorMeasurement') ? current : [...current, 'sponsorMeasurement']);
            }}
            className="accent-accent mt-1 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-semibold">I explicitly consent to Sponsor measurement</span>
            <span className="text-text-secondary mt-1 block text-sm leading-relaxed">
              Measures account-linked viewable sponsor placements, clicks on those placements and frequency. Placement context may reveal religious or philosophical interests. Sponsor placements still appear when this is off.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-muted text-xs">
          {!personalizationStatusKnown ? 'Service improvement can be changed only after Personalisation status is confirmed. Sponsor measurement can still be changed or withdrawn.' : 'Personalisation requires Service improvement analytics. Enable Service improvement before Personalisation, and turn off Personalisation before withdrawing it. Sponsor measurement remains separate.'}
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
