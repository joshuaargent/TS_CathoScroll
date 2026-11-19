'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

type PersonalizationStatus = {
  enabled: boolean;
  updated_at: string | null;
  topic_interests: number;
  category_interests: number;
  model_version: string;
  selected_categories: string[];
  category_options: { slug: string; name: string }[];
  top_topic_interests: { topic_id: string; slug: string; question: string; category_slug: string; score: number; short_term_score: number; long_term_score: number; explicit_score: number; inferred_score: number }[];
};

const emptyStatus: PersonalizationStatus = {
  enabled: false,
  updated_at: null,
  topic_interests: 0,
  category_interests: 0,
  model_version: '2026-11-19-v2',
  selected_categories: [],
  category_options: [],
  top_topic_interests: [],
};

export default function PersonalizationSettingsPage({ client }: { client?: SupabaseClient } = {}) {
  const [status, setStatus] = useState<PersonalizationStatus>(emptyStatus);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<{ slug: string; name: string }[]>([]);
  const [savingInterests, setSavingInterests] = useState(false);
  const [topTopicInterests, setTopTopicInterests] = useState<PersonalizationStatus['top_topic_interests']>([]);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const supabase = useMemo(() => client ?? createClient(), [client]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setNeedsSignIn(true);
        return;
      }
      setNeedsSignIn(false);
      const { data, error: rpcError } = await supabase.rpc('get_my_personalization_status');
      if (rpcError) throw rpcError;
      if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid personalisation settings response.');
      }
      setError('');
      setStatus({
        enabled: data.enabled,
        updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
        topic_interests: Number.isSafeInteger(data.topic_interests) ? data.topic_interests : 0,
        category_interests: Number.isSafeInteger(data.category_interests) ? data.category_interests : 0,
        model_version: typeof data.model_version === 'string' ? data.model_version : emptyStatus.model_version,
        selected_categories: Array.isArray(data.selected_categories) ? data.selected_categories.filter((item: unknown): item is string => typeof item === 'string') : [],
        category_options: Array.isArray(data.category_options) ? data.category_options.filter((item: unknown): item is { slug: string; name: string } => Boolean(item) && typeof item === 'object' && typeof (item as { slug?: unknown }).slug === 'string' && typeof (item as { name?: unknown }).name === 'string') : [],
        top_topic_interests: Array.isArray(data.top_topic_interests) ? data.top_topic_interests.filter((item: unknown): item is PersonalizationStatus['top_topic_interests'][number] => Boolean(item) && typeof item === 'object' && typeof (item as { topic_id?: unknown }).topic_id === 'string' && typeof (item as { question?: unknown }).question === 'string' && typeof (item as { score?: unknown }).score === 'number') : [],
      });
      setSelectedCategories(Array.isArray(data.selected_categories) ? data.selected_categories.filter((item: unknown): item is string => typeof item === 'string') : []);
      setCategoryOptions(Array.isArray(data.category_options) ? data.category_options.filter((item: unknown): item is { slug: string; name: string } => Boolean(item) && typeof item === 'object' && typeof (item as { slug?: unknown }).slug === 'string' && typeof (item as { name?: unknown }).name === 'string') : []);
      setTopTopicInterests(Array.isArray(data.top_topic_interests) ? data.top_topic_interests.filter((item: unknown): item is PersonalizationStatus['top_topic_interests'][number] => Boolean(item) && typeof item === 'object' && typeof (item as { topic_id?: unknown }).topic_id === 'string' && typeof (item as { question?: unknown }).question === 'string' && typeof (item as { score?: unknown }).score === 'number') : []);
    } catch (cause) {
      console.error('Unable to load personalisation settings:', cause);
      setError('Unable to load these settings. Refresh the page and try again.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [supabase]);

  // This effect only starts an asynchronous auth/RPC request; state changes occur after it resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(false); }, [load]);

  async function updateConsent(enabled: boolean) {
    if (saving || loading || enabled === status.enabled) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error('Authentication required.');
      const { data, error: rpcError } = await supabase.rpc('set_my_personalization_consent', { p_enabled: enabled });
      if (rpcError) throw rpcError;
      if (!data || typeof data !== 'object' || data.enabled !== enabled) {
        throw new Error('Personalisation settings were not confirmed.');
      }
      await load(false);
      setMessage(enabled
        ? 'Personalised recommendations are now enabled.'
        : 'Personalisation is off. Your stored interest profile has been deleted.');
    } catch (cause) {
      console.error('Unable to update personalisation consent:', cause);
      setError('Your setting could not be changed. No change has been assumed; try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveInterests() {
    if (savingInterests || loading || !status.enabled || selectedCategories.length > 20) return;
    setSavingInterests(true);
    setError('');
    setMessage('');
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error('Authentication required.');
      const { error: rpcError } = await supabase.rpc('set_my_personalization_interests', {
        p_category_slugs: selectedCategories,
      });
      if (rpcError) throw rpcError;
      setMessage('Your explicit category interests have been saved.');
      await load(false);
    } catch (cause) {
      console.error('Unable to save explicit category interests:', cause);
      setError('Your category interests could not be saved. Try again.');
    } finally {
      setSavingInterests(false);
    }
  }

  return (
    <main className="container max-w-4xl py-12">
      <Link href="/account" className="text-accent inline-flex items-center gap-2 text-sm font-medium hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to account
      </Link>
      {needsSignIn && (
        <Card padding="md" className="mt-8">
          <h2 className="text-lg font-bold">Sign in to manage personalisation</h2>
          <p className="text-text-secondary mt-2 text-sm">These controls are private to your account.</p>
          <Link href="/signin?next=%2Faccount%2Fpersonalization" className="text-accent mt-4 inline-flex font-semibold hover:underline">
            Sign in
          </Link>
        </Card>
      )}
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Account · Privacy</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Personalisation</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Control whether CathoScroll may build a private interest profile from your activity to improve your topic recommendations.
        </p>
      </div>

      {!needsSignIn && <Card padding="lg" className="mt-8">
        <div className="flex items-start gap-3">
          <span className="bg-accent-light text-accent rounded-xl p-3"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">Personalised topic recommendations</h2>
            <p className="text-text-secondary mt-2 text-sm leading-relaxed">
              If enabled, we use activity recorded after you opt in: topic reading signals (viewable time, completions, repeat visits and skips), likes, bookmarks and community interactions. These signals estimate topic and category interests. Signals decay over time, are capped, and help balance relevance with category variety.
            </p>
          </div>
        </div>

        <div className="border-border mt-6 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">I explicitly consent to CathoScroll using my topic-reading activity and selected interests, which may reveal religious or philosophical beliefs, to personalise my recommendations.</p>
              <p className="text-text-muted mt-1 text-sm">This is optional and off until you enable it. Because Catholic and religious topics may reveal religious or philosophical beliefs, this profile is treated as sensitive. It is private and never used for sponsor targeting.</p>
            </div>
            <span className={status.enabled ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'rounded-full bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary'}>
              {loading ? 'Loading' : status.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" size="sm" disabled={loading || saving || status.enabled} onClick={() => void updateConsent(true)}>
              {saving && !status.enabled ? 'Saving…' : 'I explicitly consent — enable personalisation'}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={loading || saving || !status.enabled} onClick={() => void updateConsent(false)}>
              {saving && status.enabled ? 'Saving…' : 'Turn off and delete profile'}
            </Button>
          </div>
        </div>

        <div className="border-border mt-6 border-t pt-5">
          <div>
            <h3 className="font-semibold">Categories I want to explore</h3>
            <p className="text-text-muted mt-1 text-sm">These are interests you explicitly choose. They receive a stronger recommendation signal than inferred reading behaviour.</p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {categoryOptions.map((category) => (
              <label key={category.slug} className={`border-border flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${!status.enabled ? 'opacity-50' : 'hover:bg-bg-secondary'}`}>
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(category.slug)}
                  disabled={!status.enabled || loading || savingInterests}
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
            <Button type="button" size="sm" variant="secondary" disabled={!status.enabled || loading || savingInterests || selectedCategories.length > 20} onClick={() => void saveInterests()}>
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
            <p className="text-text-muted mt-1 text-sm">These are content-interest signals, not a measure of your religious beliefs or identity. The score is a relative ranking value used by the recommendation system.</p>
            {topTopicInterests.length ? (
              <ul className="mt-3 space-y-2">
                {topTopicInterests.map((topic) => (
                  <li key={topic.topic_id} className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3">
                    <span className="min-w-0">
                      <span className="text-text-primary block text-sm font-medium">{topic.question}</span>
                      <span className="text-text-muted mt-0.5 block text-xs">{categoryOptions.find((category) => category.slug === topic.category_slug)?.name ?? topic.category_slug}</span>
                    </span>
                    <span className="text-text-secondary shrink-0 text-xs tabular-nums">Weight {topic.score.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-text-muted mt-3 text-sm">No topic interests have been calculated yet.</p>}
          </div>
        )}

        <div className="border-border mt-6 flex items-start gap-3 border-t pt-5">
          <ShieldCheck className="text-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="text-text-muted text-sm leading-relaxed">
            Your interest profile is private and is not shown on your public profile or used for sponsor targeting. Turning personalisation off immediately deletes the derived topic-interest profile and stops using reading telemetry for recommendation weighting. Existing operational analytics events remain subject to their separate 180-day retention policy. This setting is not a declaration of religious affiliation.
          </div>
        </div>
      </Card>}

      {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><Button type="button" size="sm" variant="secondary" onClick={() => void load()}>Retry</Button></div>}
      {message && <p role="status" className="mt-4 rounded-xl border border-border p-4 text-sm">{message}</p>}
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" size="sm" disabled={loading || saving} onClick={() => void load()}>Refresh status</Button>
      </div>
    </main>
  );
}
