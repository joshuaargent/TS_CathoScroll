'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { AnalyticsConsentSettingsPanel } from '@/components/account/AnalyticsConsentSettingsPanel';
import { analyticsConsentSyncEvent } from '@/lib/analytics-consent';
import { Button } from '@/components/ui/Button';
import type { CachedPersonalizationConsent } from '@/lib/offline/ranked-feed-cache';

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

type NativePersonalizationCacheResponse = {
  available: boolean;
  consent: CachedPersonalizationConsent | null;
};

function readNativePersonalizationCache(userId: string): Promise<NativePersonalizationCacheResponse> {
  if (typeof window === 'undefined') return Promise.resolve({ available: false, consent: null });
  return new Promise((resolve) => {
    let settled = false;
    let timeout: number | undefined;
    const finish = (value: NativePersonalizationCacheResponse) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve(value);
    };
    timeout = window.setTimeout(() => finish({ available: false, consent: null }), 1000);
    const complete = (result: Promise<NativePersonalizationCacheResponse>) => {
      void result.then(finish).catch(() => finish({ available: true, consent: null }));
    };
    window.dispatchEvent(new CustomEvent('cathoscroll:personalization-consent-status-request', {
      detail: { userId, complete },
    }));
  });
}

export function PersonalizationAccountSection({ client }: { client: SupabaseClient }) {
  const [status, setStatus] = useState<PersonalizationStatus>(emptyStatus);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [personalizationStatusKnown, setPersonalizationStatusKnown] = useState(false);
  const [categoryInterestsLoaded, setCategoryInterestsLoaded] = useState(false);
  const [offlineCacheAvailable, setOfflineCacheAvailable] = useState(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestVersion.current;
    try {
      // getSession reads the locally persisted auth session, so native account
      // settings can identify the current account while the device is offline.
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (request !== requestVersion.current) return false;
      if (sessionError) throw sessionError;
      const sessionUser = sessionData.session?.user;
      if (!sessionUser) throw new Error('Authentication required.');
      setAccountUserId(sessionUser.id);
      setError('');
      setMessage('');

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await readNativePersonalizationCache(sessionUser.id);
        if (request !== requestVersion.current) return false;
        setOfflineCacheAvailable(cached.available);
        if (cached.consent) {
          setStatus({
            ...emptyStatus,
            enabled: cached.consent.enabled,
            updated_at: cached.consent.checkedAt,
          });
          setSelectedCategories([]);
          setCategoryInterestsLoaded(false);
          setPersonalizationStatusKnown(true);
          setMessage(cached.consent.pendingSync
            ? 'Your personalisation choice is saved on this device and will synchronise when you reconnect.'
            : 'Offline: showing your last saved personalisation setting. Category interests will refresh when you reconnect.');
          return true;
        }
        setStatus(emptyStatus);
        setSelectedCategories([]);
        setCategoryInterestsLoaded(false);
        setPersonalizationStatusKnown(false);
        setMessage(cached.available
          ? 'Your previous personalisation status is not cached. You can still turn it off on this device.'
          : 'Personalisation settings need a connection on this device.');
        return false;
      }

      const { data: authData, error: authError } = await client.auth.getUser();
      if (request !== requestVersion.current) return false;
      if (authError) throw authError;
      if (!authData.user || authData.user.id !== sessionUser.id) throw new Error('The signed-in account changed. Refresh settings.');
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
      setCategoryInterestsLoaded(true);
      setPersonalizationStatusKnown(true);
      setOfflineCacheAvailable(false);
      return true;
    } catch (cause) {
      if (request !== requestVersion.current) return false;
      console.error('Unable to load personalisation settings:', cause);
      setPersonalizationStatusKnown(false);
      setCategoryInterestsLoaded(false);
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
    const forcedOfflineWithdrawal = !enabled && !personalizationStatusKnown && offlineCacheAvailable;
    if (saving || savingInterests || loading || (enabled === status.enabled && !forcedOfflineWithdrawal)) return;
    setSaving(true);
    setError('');
    setMessage('');
    let localWithdrawalSaved = false;
    const syncNativeConsent = async (userId: string, nextEnabled: boolean, pendingSync: boolean) => {
      let nativeCacheSync: Promise<void> | null = null;
      window.dispatchEvent(new CustomEvent('cathoscroll:personalization-consent-changed', {
        detail: {
          userId,
          enabled: nextEnabled,
          pendingSync,
          complete: (result: Promise<void>) => { nativeCacheSync = result; },
        },
      }));
      if (nativeCacheSync) await nativeCacheSync;
      return nativeCacheSync !== null;
    };
    try {
      // The identity was captured during the last successful settings load.
      // Use it to write a local denial before any network-dependent auth call.
      if (!enabled) {
        if (!accountUserId) throw new Error('The account identity is not available on this device.');
        localWithdrawalSaved = await syncNativeConsent(accountUserId, false, true);
        if (localWithdrawalSaved) {
          setStatus((current) => ({ ...current, enabled: false, topic_interests: 0, category_interests: 0, selected_categories: [], top_topic_interests: [] }));
          setPersonalizationStatusKnown(true);
          setCategoryInterestsLoaded(false);
        }
      }

      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error('Authentication required.');
      if (accountUserId && authData.user.id !== accountUserId) {
        throw new Error('The signed-in account changed. Refresh settings before changing consent.');
      }

      const { data, error: rpcError } = await client.rpc('set_my_personalization_consent', {
        p_enabled: enabled,
        p_consent_version: '2026-11-20-v4',
      });
      if (rpcError) throw rpcError;
      if (!isRecord(data) || data.enabled !== enabled) {
        throw new Error('Personalisation settings were not confirmed.');
      }
      await syncNativeConsent(authData.user.id, enabled, false);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(analyticsConsentSyncEvent));

      const refreshed = await load();
      setMessage(refreshed
        ? enabled
          ? 'Personalised recommendations are now enabled.'
          : 'Personalisation is off. Your stored interest profile has been deleted.'
        : 'Your setting was saved, but the latest status could not be refreshed. Use Refresh status to verify it.');
    } catch (cause) {
      console.error('Unable to update personalisation consent:', cause);
      if (!enabled && localWithdrawalSaved) {
        setStatus((current) => ({ ...current, enabled: false, topic_interests: 0, category_interests: 0, selected_categories: [], top_topic_interests: [] }));
        setCategoryInterestsLoaded(false);
        setMessage(navigator.onLine
          ? 'Personalisation is disabled on this device. The server could not confirm the change; it will retry when the feed reconnects.'
          : 'Personalisation is disabled on this device. The server setting will synchronise when you reconnect.');
      } else {
        setError(enabled
          ? 'Your setting could not be changed. No change has been assumed; try again.'
          : 'Personalisation is disabled locally, but the server could not confirm the change. Reconnect and refresh to synchronise it.');
      }
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
    if (saving || savingInterests || loading || !status.enabled || !categoryInterestsLoaded || selectedCategories.length > 20) return;
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
    <section id="personalization" className="mt-10 w-full scroll-mt-8">
      <div className="border-border bg-bg-card rounded-2xl border p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="bg-accent-light text-accent rounded-xl p-3">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="mt-1 text-2xl font-bold">Personalisation</h2>
              </div>
              <span
                role="status"
                aria-live="polite"
                className={status.enabled
                  ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'rounded-full bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary'}
              >
                {loading ? 'Loading status…' : !personalizationStatusKnown ? 'Status unavailable' : status.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-text-secondary mt-2 text-sm leading-relaxed">
              Build a private interest profile to tailor your topic recommendations. This is optional and off until you enable it; account actions and reading signals recorded after you opt in are used. Service improvement analytics is enabled with personalisation.
            </p>
          </div>
        </div>

        <div className="border-border bg-bg-secondary/30 mt-6 rounded-xl border p-4">
          <p className="font-semibold text-sm leading-relaxed">
            I explicitly consent to CathoScroll using my account actions, selected interests and reading analytics (including views, reading duration, swipes and skips) to personalise my recommendations. Enabling personalisation also enables Service improvement analytics until I turn personalisation off. These signals may reveal religious or philosophical beliefs; they are used to rank content, not to label my beliefs.
          </p>
          <p className="text-text-muted mt-2 text-sm leading-relaxed">
            Your recommendations use your explicit account actions, selected categories and reading signals such as viewable impressions, reading time, swipes, skips and completions. Enabling personalisation also enables Service improvement analytics; that choice stays on until you turn personalisation off. The profile is private, never used for sponsor targeting, and can be deleted by withdrawing consent.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              size="sm"
              disabled={loading || saving || savingInterests || !personalizationStatusKnown || status.enabled || Boolean(error)}
              onClick={() => void updateConsent(true)}
            >
              {saving && !status.enabled ? 'Saving…' : 'I explicitly consent — enable personalisation'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading || saving || savingInterests || (!status.enabled && !(offlineCacheAvailable && !personalizationStatusKnown))}
              onClick={() => void updateConsent(false)}
            >
              {saving ? 'Saving…' : !personalizationStatusKnown && offlineCacheAvailable ? 'Turn off personalisation offline' : 'Turn off and delete profile'}
            </Button>
          </div>
        </div>

        <div className="border-border mt-6 border-t pt-5">
          <h3 className="font-semibold">Categories I want to explore</h3>
          <p className="text-text-muted mt-1 text-sm">
            These categories are your direct preferences. They are combined with your explicit account actions and eligible reading signals while personalisation is enabled.
          </p>
          {!categoryInterestsLoaded && status.enabled && (
            <p className="text-text-muted mt-3 text-sm">Saved category interests are not available offline. Reconnect to load them before editing or saving.</p>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {status.category_options.map((category) => (
              <label
                key={category.slug}
                className={`border-border flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${!status.enabled || !categoryInterestsLoaded ? 'opacity-50' : 'hover:bg-bg-secondary'}`}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(category.slug)}
                  disabled={!status.enabled || !categoryInterestsLoaded || loading || saving || savingInterests}
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
            <p className="text-text-muted text-xs">{categoryInterestsLoaded ? `${selectedCategories.length} selected · up to 20` : 'Saved interests unavailable offline'}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!status.enabled || !categoryInterestsLoaded || loading || saving || savingInterests || selectedCategories.length > 20}
              onClick={() => void saveInterests()}
            >
              {savingInterests ? 'Saving interests…' : 'Save category interests'}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="bg-bg-secondary/60 rounded-xl p-4">
            <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Topic interests stored</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{loading || !categoryInterestsLoaded ? '—' : status.topic_interests}</p>
          </div>
          <div className="bg-bg-secondary/60 rounded-xl p-4">
            <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Category interests stored</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{loading || !categoryInterestsLoaded ? '—' : status.category_interests}</p>
          </div>
        </div>

        {status.enabled && (
          <div className="border-border mt-6 border-t pt-5">
            <h3 className="font-semibold">Topics currently influencing your recommendations</h3>
            <p className="text-text-muted mt-1 text-sm">
              These are content-interest signals, not a measure of your religious beliefs or identity. The score is a relative ranking value used by the recommendation system.
            </p>
            {!categoryInterestsLoaded ? (
              <p className="text-text-muted mt-3 text-sm">Topic-interest details are unavailable offline. Reconnect to load them.</p>
            ) : status.top_topic_interests.length ? (
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
            Your profile is private and is not shown on your public profile or used for sponsor targeting. Turning this off deletes the profile and stops recommendation weighting; operational analytics follow a separate retention policy.
          </p>
        </div>

        <AnalyticsConsentSettingsPanel
          userId={accountUserId}
          personalizationEnabled={status.enabled}
          personalizationStatusKnown={personalizationStatusKnown}
          disabled={loading || !accountUserId}
        />

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
