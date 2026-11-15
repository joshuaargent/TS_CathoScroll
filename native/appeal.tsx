import { useEffect, useState } from 'react';

import { CommentBanAppealPageView } from '@/components/comments/CommentBanAppealPageView';
import { siteConfig } from '@/lib/constants';
import { createClient } from './supabase';

type AppealDetails = {
  ban: { created_at: string } | null;
  appeal: { created_at: string } | null;
};

type AppealLoadState = {
  userId: string;
  attempt: number;
  value: AppealDetails | null;
  loading: boolean;
  error: string;
};

export function NativeAppeal({
  userId,
  onRequireSignIn,
}: {
  userId: string | null;
  onRequireSignIn: () => void;
}) {
  const [state, setState] = useState<AppealLoadState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;

    const accountId = userId;
    let active = true;

    async function load() {
      try {
        const { data, error: sessionError } = await createClient().auth.getSession();
        if (sessionError) throw sessionError;
        const token = data.session?.access_token;
        if (!token) throw new Error('Sign in again to request a review.');

        const response = await fetch(new URL('/api/comment-ban/appeal', siteConfig.url), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const result = (await response.json()) as AppealDetails & { error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Unable to load your appeal details.');
        if (
          !result ||
          (result.ban !== null && typeof result.ban?.created_at !== 'string') ||
          (result.appeal !== null && typeof result.appeal?.created_at !== 'string')
        ) {
          throw new Error('The appeal service returned invalid data.');
        }
        if (active) {
          setState({
            userId: accountId,
            attempt,
            value: result,
            loading: false,
            error: '',
          });
        }
      } catch (cause) {
        console.error('Unable to load native comment-ban appeal details:', cause);
        if (active) {
          setState({
            userId: accountId,
            attempt,
            value: null,
            loading: false,
            error: cause instanceof Error ? cause.message : 'Unable to load your appeal details.',
          });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  async function submitter(message: string) {
    if (!userId) throw new Error('Sign in to request a review.');
    const { data, error: sessionError } = await createClient().auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again to request a review.');

    const response = await fetch(new URL('/api/comment-ban/appeal', siteConfig.url), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Unable to submit your request.');
  }

  if (!userId) {
    return (
      <main className="container py-12">
        <section className="mt-8 mb-10">
          <h1 className="text-5xl font-extrabold md:text-7xl">Request a review</h1>
          <p className="text-text-secondary mt-4 max-w-2xl text-lg">
            Ask the CathoScroll team to review your comment restriction.
          </p>
        </section>
        <div className="border-border mx-auto max-w-2xl rounded-2xl border p-6">
          <p>You must sign in before requesting a review.</p>
          <button type="button" onClick={onRequireSignIn} className="text-accent mt-4 underline">
            Sign in
          </button>
        </div>
      </main>
    );
  }

  const current = state?.userId === userId && state.attempt === attempt ? state : null;
  return (
    <CommentBanAppealPageView
      banCreatedAt={current?.value?.ban?.created_at ?? null}
      pendingAppealCreatedAt={current?.value?.appeal?.created_at ?? null}
      loading={!current || current.loading}
      error={current?.error ?? ''}
      submitter={submitter}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
