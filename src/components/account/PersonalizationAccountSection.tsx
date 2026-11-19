'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { Button } from '@/components/ui/Button';

type PersonalizationStatus = {
  enabled: boolean;
  updated_at: string | null;
  topic_interests: number;
  category_interests: number;
  selected_categories: string[];
  category_options: { slug: string; name: string }[];
  top_topic_interests: {
    topic_id: string;
    question: string;
    category_slug: string;
    score: number;
  }[];
};

const emptyStatus: PersonalizationStatus = {
  enabled: false,
  updated_at: null,
  topic_interests: 0,
  category_interests: 0,
  selected_categories: [],
  category_options: [],
  top_topic_interests: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readCategories(value: unknown): { slug: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { slug: string; name: string } =>
      isRecord(item) && typeof item.slug === 'string' && typeof item.name === 'string'
  );
}

function readTopicInterests(value: unknown): PersonalizationStatus['top_topic_interests'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PersonalizationStatus['top_topic_interests'][number] =>
      isRecord(item) &&
      typeof item.topic_id === 'string' &&
      typeof item.question === 'string' &&
      typeof item.category_slug === 'string' &&
      typeof item.score === 'number' &&
      Number.isFinite(item.score)
  );
}

export function PersonalizationAccountSection({ client }: { client: SupabaseClient }) {
  const [status, setStatus] = useState<PersonalizationStatus>(emptyStatus);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestVersion.current;
    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (request !== requestVersion.current) return false;
      if (authError) throw authError;
      if (!authData.user) throw new Error('Authentication required.');
      setError('');

      const { data, error: rpcError } = await client.rpc('get_my_personalization_status');
      if (request !== requestVersion.current) return false;
      if (rpcError) throw rpcError;
      if (!isRecord(data) || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid personalisation settings response.');
      }

      const nextStatus: PersonalizationStatus = {
        enabled: data.enabled,
        updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
        topic_interests: Number.isSafeInteger(data.topic_interests) ? Number(data.topic_interests) : 0,
        category_interests: Number.isSafeInteger(data.category_interests) ? Number(data.category_interests) : 0,
        selected_categories: readStringArray(data.selected_categories),
        category_options: readCategories(data.category_options),
        top_topic_interests: readTopicInterests(data.top_topic_interests),
      };
      setStatus(nextStatus);
      setSelectedCategories(nextStatus.selected_categories);
      return true;
    } catch (cause) {
      if (request !== requestVersion.current) return false;
      console.error('Unable to load personalisation settings:', cause);
      setError('Unable to load these settings. Check your connection and retry.');
      return false;
    } finally {
      // Only the newest request may release the loading state.
      if (request === requestVersion.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let active = true;

    // Start the initial request in a microtask. This keeps state updates inside
    // the async request lifecycle rather than running them synchronously from
    // the effect body, while still loading immediately after mount.
    void Promise.resolve().then(() => {
      if (active) void load();
    });

    return () => {
      active = false;
      requestVersion.current += 1;
    };
  }, [load]);

  async function updateConsent(enabled: boolean) {
    if (saving || savingInterests || loading || enabled === status.enabled) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error('Authentication required.');

      const { data, error: rpcError } = await client.rpc('set_my_personalization_consent', {
        p_enabled: enabled,
      });
      if (rpcError) throw rpcError;
      if (!isRecord(data) || data.enabled !== enabled) {
        throw new Error('Personalisation settings were not confirmed.');
      }

      const refreshed = await load();
      setMessage(refreshed
        ? enabled
          ? 'Personalised recommendations are now enabled.'
          : 'Personalisation is off. Your stored interest profile has been deleted.'
        : 'Your setting was saved, but the latest status could not be refreshed. Use Refresh status to verify it.');
    } catch (cause) {
      console.error('Unable to update personalisation consent:', cause);
      setError('Your setting could not be changed. No change has been assumed; try again.');
    } finally {
      setSaving(false);
    }
  }

  function refreshStatus() {
    if (loading) return;
    setLoading(true);
    void load();
  }

  async function saveInterests() {
    if (saving || savingInterests || loading || !status.enabled || selectedCategories.length > 20) return;
    setSavingInterests(true);
    setError('');
    setMessage('');
    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error('Authentication required.');

      const { error: rpcError } = await client.rpc('set_my_personalization_interests', {
        p_category_slugs: selectedCategories,
      });
      if (rpcError) throw rpcError;

      const refreshed = await load();
      setMessage(refreshed
        ? 'Your explicit category interests have been saved.'
        : 'Your interests were saved, but the latest status could not be refreshed. Use Refresh status to verify them.');
    } catch (cause) {
      console.error('Unable to save explicit category interests:', cause);
      setError('Your category interests could not be saved. Try again.');
    } finally {
      setSavingInterests(false);
    }
  }

  return (
    <section id="personalization" className="container mt-10 scroll-mt-8">
      <div className="border-border bg-bg-secondary/40 rounded-2xl border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="bg-accent-light text-accent rounded-xl p-3">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-accent text-xs font-semibold tracking-wider uppercase">Account · Privacy</p>
                <h2 className="mt-1 text-2xl font-bold">Personalisation</h2>
              </div>
              <span
                role="status"
                aria-live="polite"
                className={status.enabled
                  ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'rounded-full bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary'}
              >
                {loading ? 'Loading status…' : status.enabled ? 'Enabled' : error ? 'Unavailable' : 'Disabled'}
              </span>
            </div>
            <p className="text-text-secondary mt-3 text-sm leading-relaxed">
              Control whether CathoScroll may build a private interest profile from your activity to improve your topic recommendations.
              This is optional and off until you enable it. Only activity recorded after you opt in is used to build this profile.
            </p>
          </div>
        </div>

        <div className="border-border mt-6 rounded-xl border p-4">
          <p className="font-semibold text-sm leading-relaxed">
            I explicitly consent to CathoScroll using my topic-reading activity and selected interests, which may reveal religious or philosophical beliefs, to personalise my recommendations.
          </p>
          <p className="text-text-muted mt-2 text-sm leading-relaxed">
            Because Catholic and religious topics may reveal religious or philosophical beliefs, this profile is treated as sensitive. It is private and never used for sponsor targeting. You can withdraw consent at any time.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              size="sm"
              disabled={loading || saving || savingInterests || status.enabled || Boolean(error)}
              onClick={() => void updateConsent(true)}
            >
              {saving && !status.enabled ? 'Saving…' : 'I explicitly consent — enable personalisation'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading || saving || savingInterests || !status.enabled}
              onClick={() => void updateConsent(false)}
            >
              {saving && status.enabled ? 'Saving…' : 'Turn off and delete profile'}
            </Button>
          </div>
        </div>

        <div className="border-border mt-6 border-t pt-5">
          <h3 className="font-semibold">Categories I want to explore</h3>
          <p className="text-text-muted mt-1 text-sm">
            These are interests you explicitly choose. They receive a stronger recommendation signal than inferred reading behaviour.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {status.category_options.map((category) => (
              <label
                key={category.slug}
                className={`border-border flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${!status.enabled ? 'opacity-50' : 'hover:bg-bg-secondary'}`}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(category.slug)}
                  disabled={!status.enabled || loading || saving || savingInterests}
                  onChange={(event) => setSelectedCategories((current) => event.target.checked
                    ? [...current, category.slug]
                    : current.filter((slug) => slug !== category.slug))}
                  className="accent-accent h-4 w-4"
                />
                <span className="font-medium">{category.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-text-muted text-xs">{selectedCategories.length} selected · up to 20</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!status.enabled || loading || saving || savingInterests || selectedCategories.length > 20}
              onClick={() => void saveInterests()}
            >
              {savingInterests ? 'Saving interests…' : 'Save category interests'}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="bg-bg-secondary/60 rounded-xl p-4">
            <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Topic interests stored</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{loading ? '—' : status.topic_interests}</p>
          </div>
          <div className="bg-bg-secondary/60 rounded-xl p-4">
            <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Category interests stored</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{loading ? '—' : status.category_interests}</p>
          </div>
        </div>

        {status.enabled && (
          <div className="border-border mt-6 border-t pt-5">
            <h3 className="font-semibold">Topics currently influencing your recommendations</h3>
            <p className="text-text-muted mt-1 text-sm">
              These are content-interest signals, not a measure of your religious beliefs or identity. The score is a relative ranking value used by the recommendation system.
            </p>
            {status.top_topic_interests.length ? (
              <ul className="mt-3 space-y-2">
                {status.top_topic_interests.map((topic) => (
                  <li key={topic.topic_id} className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3">
                    <span className="min-w-0">
                      <span className="text-text-primary block text-sm font-medium">{topic.question}</span>
                      <span className="text-text-muted mt-0.5 block text-xs">
                        {status.category_options.find((category) => category.slug === topic.category_slug)?.name ?? topic.category_slug}
                      </span>
                    </span>
                    <span className="text-text-secondary shrink-0 text-xs tabular-nums">Weight {topic.score.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-muted mt-3 text-sm">No topic interests have been calculated yet.</p>
            )}
          </div>
        )}

        <div className="border-border mt-6 flex items-start gap-3 border-t pt-5">
          <ShieldCheck className="text-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="text-text-muted text-sm leading-relaxed">
            Your interest profile is private and is not shown on your public profile or used for sponsor targeting. Turning personalisation off deletes the derived topic-interest profile and stops using reading telemetry for recommendation weighting. Existing operational analytics events remain subject to their separate retention policy. This setting is not a declaration of religious affiliation.
          </p>
        </div>

        {error && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>{error}</span>
            <Button type="button" size="sm" variant="secondary" onClick={refreshStatus}>
              Retry
            </Button>
          </div>
        )}
        {message && <p role="status" className="mt-4 rounded-xl border border-border p-4 text-sm">{message}</p>}
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="secondary" size="sm" disabled={loading || saving || savingInterests} onClick={() => void load()}>
            Refresh status
          </Button>
        </div>
      </div>
    </section>
  );
}
