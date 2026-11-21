'use client';

import { useEffect, useState } from 'react';
import {
  anonymousAnalyticsPreferenceChangeEvent,
  isAnonymousFeedAnalyticsEnabled,
  setAnonymousFeedAnalyticsEnabled,
} from '@/lib/anonymous-feed-analytics-client';

export function AnonymousAnalyticsPreference() {
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => setEnabled(isAnonymousFeedAnalyticsEnabled());
    refresh();
    window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, refresh);
    return () => window.removeEventListener(anonymousAnalyticsPreferenceChangeEvent, refresh);
  }, []);

  async function update() {
    if (saving) return;
    setSaving(true);
    setError('');
    const next = !enabled;
    try {
      await setAnonymousFeedAnalyticsEnabled(next);
      setEnabled(next);
    } catch (cause) {
      console.error('Unable to update anonymous aggregate measurement preference:', cause);
      setEnabled(false);
      setError('The objection could not be confirmed. Measurement remains disabled on this device.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-border bg-bg-card mt-5 rounded-xl border p-4">
      <p className="text-text-primary text-sm font-semibold">Signed-out aggregate measurement</p>
      <p className="text-text-secondary mt-1 text-sm leading-relaxed">
        CathoScroll counts signed-out topic and comment activity in daily totals without visitor or session IDs. This does not create a visitor profile. You can object at any time.
      </p>
      <button
        type="button"
        disabled={saving}
        onClick={() => void update()}
        className="text-accent mt-3 text-sm font-semibold underline underline-offset-2 disabled:opacity-50"
      >
        {saving ? 'Saving…' : enabled ? 'Turn off aggregate measurement' : 'Turn on aggregate measurement'}
      </button>
      {error && <p className="text-destructive mt-2 text-sm" role="alert">{error}</p>}
    </div>
  );
}
