'use client';

import { useEffect, useState } from 'react';
import {
  anonymousAnalyticsPreferenceKey,
  setAnonymousFeedAnalyticsEnabled,
} from '@/lib/anonymous-feed-analytics-client';

export function AnonymousAnalyticsPreference() {
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(anonymousAnalyticsPreferenceKey) !== 'false');
    } catch {
      setEnabled(false);
      setMessage('Device storage is unavailable. Anonymous topic/comment analytics is disabled in this browser session.');
    }
    setReady(true);
  }, []);

  async function update(next: boolean) {
    if (busy || !ready) return;
    setBusy(true);
    setMessage('');
    try {
      await setAnonymousFeedAnalyticsEnabled(next);
      setEnabled(next);
      setMessage(next
        ? 'Anonymous topic/comment analytics is enabled.'
        : 'Anonymous topic/comment analytics is off. Pending local events have been cleared.');
    } catch {
      setEnabled(false);
      setMessage('The preference could not be saved. Analytics is disabled for this session; check device storage and retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border bg-bg-card rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Anonymous topic and Top Comments analytics</p>
          <p className="text-text-secondary mt-1 text-sm">
            Used only to measure and improve CathoScroll. No persistent visitor, account or session identifier is created.
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || busy}
          aria-pressed={enabled}
          onClick={() => void update(!enabled)}
          className="border-border rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="text-text-muted mt-3 text-sm" role="status" aria-live="polite">
        {message || (ready ? (enabled ? 'Currently enabled. You can object at any time.' : 'Currently off.') : 'Loading preference…')}
      </p>
    </div>
  );
}
