'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';

export function PersonalizationAccountSection({ client }: { client: SupabaseClient }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await client.rpc('get_my_personalization_status');
      if (rpcError) throw rpcError;
      if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid personalisation status response.');
      }
      setEnabled(data.enabled);
    } catch (cause) {
      console.error('Unable to load personalisation status:', cause);
      setError('Personalisation status is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    // The effect starts an asynchronous request; state updates occur after it resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function updateConsent(nextEnabled: boolean) {
    if (loading || saving || enabled === nextEnabled) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: rpcError } = await client.rpc('set_my_personalization_consent', {
        p_enabled: nextEnabled,
      });
      if (rpcError) throw rpcError;
      if (!data || typeof data !== 'object' || data.enabled !== nextEnabled) {
        throw new Error('Personalisation setting was not confirmed.');
      }
      setEnabled(nextEnabled);
    } catch (cause) {
      console.error('Unable to update personalisation consent:', cause);
      setError('Your setting could not be changed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="container mt-6">
      <div className="border-border bg-bg-secondary/40 rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">Personalised recommendations</h2>
            <p className="text-text-secondary mt-1 text-sm leading-relaxed">
              Optional. When enabled, your reading activity and chosen interests build a private topic profile. Because CathoScroll covers Catholic subjects, this may reveal religious or philosophical interests. It is never used for sponsor targeting.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={loading || saving}
                onChange={(event) => void updateConsent(event.target.checked)}
                className="accent-accent mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="text-text-primary font-medium">
                I explicitly consent to using my activity to personalise my recommendations.
                <span className="text-text-muted mt-1 block font-normal">
                  {loading ? 'Checking your current choice…' : saving ? 'Saving your choice…' : enabled ? 'Enabled. You can withdraw consent at any time.' : 'Off. Nothing is profiled until you opt in.'}
                </span>
              </span>
            </label>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          </div>
          <Link
            href="/account/personalization"
            className="border-border shrink-0 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-bg-secondary"
          >
            Manage details
          </Link>
        </div>
      </div>
    </section>
  );
}
