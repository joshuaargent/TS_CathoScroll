'use client';

import { useEffect, useState } from 'react';
import {
  anonymousAnalyticsPreferenceChangeEvent,
  readAnonymousAnalyticsPreferences,
  saveAnonymousAnalyticsObjection,
  type AnonymousAnalyticsPreferences,
} from '@/lib/anonymous-analytics-preferences';

export function AnonymousAnalyticsPreference() {
  const [preferences, setPreferences] = useState<AnonymousAnalyticsPreferences | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => setPreferences(readAnonymousAnalyticsPreferences());
    refresh();
    window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(anonymousAnalyticsPreferenceChangeEvent, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const update = (purpose: 'serviceImprovement' | 'sponsorMeasurement', objected: boolean) => {
    try {
      const next = saveAnonymousAnalyticsObjection(purpose, objected);
      setPreferences(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this preference.');
    }
  };

  const topicObjected = preferences?.serviceImprovementObjected ?? true;
  const sponsorObjected = preferences?.sponsorMeasurementObjected ?? true;

  return (
    <section aria-labelledby="anonymous-analytics-preferences-title" className="space-y-5 rounded-2xl border border-border bg-bg-secondary/40 p-5">
      <div>
        <h3 id="anonymous-analytics-preferences-title" className="text-lg font-semibold text-text-primary">
          Anonymous analytics when signed out
        </h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          These controls apply to signed-out use of this browser or app. They are separate from the account-linked choices in Account settings. Objecting does not affect the feed or sponsor delivery.
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={topicObjected}
          disabled={!preferences}
          onChange={(event) => update('serviceImprovement', event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">
            Do not collect anonymous topic and Top Comments statistics
          </span>
          <span className="mt-1 block text-sm leading-6 text-text-secondary">
            Unless you object, we aggregate impressions, viewability, reading duration, skips, completions and comment opens without account, visitor or session identifiers. If you object, new events stop and pending anonymous events on this device are cleared.
          </span>
        </span>
      </label>

      <div className="border-t border-border" />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={sponsorObjected}
          disabled={!preferences}
          onChange={(event) => update('sponsorMeasurement', event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">
            Do not collect anonymous sponsor measurement
          </span>
          <span className="mt-1 block text-sm leading-6 text-text-secondary">
            Unless you object, we aggregate sponsor placements, viewable impressions, clicks, viewing duration and frequency without account, visitor or persistent session identifiers. If you object, sponsor placements continue but no new sponsor measurement is recorded; pending in-memory events are discarded.
          </span>
        </span>
      </label>

      {!preferences && (
        <p role="status" className="text-sm text-text-secondary">
          Preferences could not be read from this device. Anonymous measurement is paused until the settings can be saved.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-text-secondary">{error}</p>}
    </section>
  );
}
