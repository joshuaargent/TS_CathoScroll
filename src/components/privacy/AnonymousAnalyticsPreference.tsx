'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  anonymousAnalyticsPreferenceChangeEvent,
  anonymousAnalyticsPreferenceKey,
  setAnonymousFeedAnalyticsEnabled,
} from '@/lib/anonymous-feed-analytics-client';

function getPreferenceSnapshot(): boolean {
  try {
    return window.localStorage.getItem(anonymousAnalyticsPreferenceKey) !== 'false';
  } catch {
    return false;
  }
}

function getServerPreferenceSnapshot(): boolean {
  return true;
}

function subscribeToPreference(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(anonymousAnalyticsPreferenceChangeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(anonymousAnalyticsPreferenceChangeEvent, onChange);
  };
}

export function AnonymousAnalyticsPreference() {
  const enabled = useSyncExternalStore(
    subscribeToPreference,
    getPreferenceSnapshot,
    getServerPreferenceSnapshot
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function update(next: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setAnonymousFeedAnalyticsEnabled(next);
      setMessage(next
        ? 'Anonymous topic/comment analytics is enabled.'
        : 'Anonymous topic/comment analytics is off. Pending local events have been cleared.');
    } catch {
      setMessage('The preference is off, but pending local events could not be cleared. Analytics will not upload while it remains off; retry after checking device storage.');
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
          disabled={busy}
          aria-pressed={enabled}
          onClick={() => void update(!enabled)}
          className="border-border rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="text-text-muted mt-3 text-sm" role="status" aria-live="polite">
        {message || (enabled ? 'Currently enabled. You can object at any time.' : 'Currently off.')}
      </p>
    </div>
  );
}
