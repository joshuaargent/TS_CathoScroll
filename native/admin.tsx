import { useCallback, useEffect, useState } from 'react';
import { AdminAppealList } from '@/components/admin/AdminAppealList';
import { AdminContentManager, type AdminContentCategory, type AdminContentTopic } from '@/components/admin/AdminContentManager';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { AdminReportList } from '@/components/admin/AdminReportList';
import type { AdminCommentBanAppeal, AdminCommentReport } from '@/lib/moderation/types';
import { siteConfig } from '@/lib/constants';
import { createClient } from './supabase';

type AdminSection = 'dashboard' | 'reports' | 'appeals' | 'content';

type AdminResponse = {
  adminUserId?: string;
  reports?: AdminCommentReport[];
  appeals?: AdminCommentBanAppeal[];
  items?: AdminCommentReport[] | AdminCommentBanAppeal[];
  hasNext?: boolean;
  categories?: AdminContentCategory[];
  topics?: AdminContentTopic[];
  error?: string;
};

export function NativeAdmin({
  userId,
  section,
  page,
}: {
  userId: string | null;
  section: AdminSection;
  page: number;
}) {
  const [reports, setReports] = useState<AdminCommentReport[]>([]);
  const [appeals, setAppeals] = useState<AdminCommentBanAppeal[]>([]);
  const [adminUserId, setAdminUserId] = useState('');
  const [hasNext, setHasNext] = useState(false);
  const [categories, setCategories] = useState<AdminContentCategory[]>([]);
  const [topics, setTopics] = useState<AdminContentTopic[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([userId, section, page, attempt]);
  const loading = Boolean(userId) && loadedKey !== requestKey;
  const error = !userId
    ? 'Sign in with an administrator account to use moderation tools.'
    : loadError?.key === requestKey
      ? loadError.message
      : '';

  const fetcher = useCallback<typeof fetch>(async (input, init) => {
    const { data, error: sessionError } = await createClient().auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again to access admin tools.');

    const requestUrl =
      typeof input === 'string'
        ? new URL(input, siteConfig.url)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return globalThis.fetch(requestUrl, {
      ...init,
      headers,
      credentials: 'omit',
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function load() {
      try {
        const params = new URLSearchParams({ section, page: String(page) });
        const response = section === 'content'
          ? await fetcher('/api/admin/content')
          : await fetcher(`/api/admin/native?${params.toString()}`);
        const result = (await response.json()) as AdminResponse;
        if (!response.ok) {
          throw new Error(
            result.error ??
              (response.status === 403
                ? 'This account does not have administrator access.'
                : 'Unable to load moderation tools.')
          );
        }
        if (!active) return;
        setLoadError(null);
        if (section === 'content') {
          if (!Array.isArray(result.categories) || !Array.isArray(result.topics)) {
            throw new Error('The content library returned invalid data.');
          }
          setCategories(result.categories);
          setTopics(result.topics);
          setReports([]);
          setAppeals([]);
        } else if (section === 'dashboard') {
          if (!Array.isArray(result.reports) || !Array.isArray(result.appeals)) {
            throw new Error('The moderation dashboard returned invalid data.');
          }
          setReports(result.reports);
          setAppeals(result.appeals);
        } else if (section === 'reports') {
          if (!Array.isArray(result.items)) throw new Error('The report list returned invalid data.');
          setReports(result.items as AdminCommentReport[]);
          setAppeals([]);
        } else {
          if (!Array.isArray(result.items)) throw new Error('The appeal list returned invalid data.');
          setAppeals(result.items as AdminCommentBanAppeal[]);
          setReports([]);
        }
        setAdminUserId(result.adminUserId ?? userId);
        setHasNext(Boolean(result.hasNext));
      } catch (cause) {
        console.error('Unable to load native moderation tools:', cause);
        if (active) {
          setLoadError({
            key: requestKey,
            message: cause instanceof Error ? cause.message : 'Unable to load moderation tools.',
          });
        }
      } finally {
        if (active) setLoadedKey(requestKey);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [userId, section, page, fetcher, attempt, requestKey]);

  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  const title =
    section === 'reports'
      ? 'Comment reports'
      : section === 'appeals'
        ? 'Comment-ban appeals'
        : section === 'content'
          ? 'Content library'
          : 'Admin dashboard';

  return (
    <main className="container py-12">
      <div className="mt-8">
        <p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">{title}</h1>
        <p className="text-text-secondary mt-3 max-w-3xl">
          {section === 'content'
            ? 'Create, edit, organise, publish, and maintain the shared learning library.'
            : 'Review private reports, comment-ban appeals, and user comment restrictions. All privileged actions are verified by the server.'}
        </p>
      </div>
      <div className="mt-8">
        <AdminNavigation />
      </div>

      {loading && <p role="status">Loading moderation data…</p>}
      {!loading && error && (
        <div role="alert" className="border-border rounded-xl border p-5">
          <p>{error}</p>
          {userId && (
            <button
              type="button"
              className="text-accent mt-3 underline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && section === 'dashboard' && (
        <>
          <section className="mb-12">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Latest comment reports</h2>
                <p className="text-text-muted mt-1 text-sm">Reporter identities are visible only to admins.</p>
              </div>
              <a href="/admin/reports" className="text-accent text-sm font-medium hover:underline">
                View all reports
              </a>
            </div>
            <AdminReportList reports={reports} adminUserId={adminUserId} fetcher={fetcher} onChange={() => setAttempt((value) => value + 1)} />
          </section>
          <section>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Latest comment-ban appeals</h2>
                <p className="text-text-muted mt-1 text-sm">Review the full comment and reply history before deciding.</p>
              </div>
              <a href="/admin/appeals" className="text-accent text-sm font-medium hover:underline">
                View all appeals
              </a>
            </div>
            <AdminAppealList appeals={appeals} fetcher={fetcher} />
          </section>
        </>
      )}

      {!loading && !error && section === 'content' && (
        <AdminContentManager
          categories={categories}
          topics={topics}
          fetcher={fetcher}
          onSaved={() => setAttempt((value) => value + 1)}
        />
      )}

      {!loading && !error && section === 'reports' && (
        <>
          <AdminReportList reports={reports} adminUserId={adminUserId} fetcher={fetcher} onChange={() => setAttempt((value) => value + 1)} />
          <div className="mt-8 flex justify-between">
            {page > 0 ? (
              <a href={`/admin/reports?page=${page - 1}`} className="border-border rounded-lg border px-4 py-2 text-sm">
                Newer reports
              </a>
            ) : <span />}
            {hasNext && (
              <a href={`/admin/reports?page=${page + 1}`} className="border-border rounded-lg border px-4 py-2 text-sm">
                Older reports
              </a>
            )}
          </div>
        </>
      )}

      {!loading && !error && section === 'appeals' && (
        <>
          <AdminAppealList appeals={appeals} fetcher={fetcher} />
          <div className="mt-8 flex justify-between">
            {page > 0 ? (
              <a href={`/admin/appeals?page=${page - 1}`} className="border-border rounded-lg border px-4 py-2 text-sm">
                Newer appeals
              </a>
            ) : <span />}
            {hasNext && (
              <a href={`/admin/appeals?page=${page + 1}`} className="border-border rounded-lg border px-4 py-2 text-sm">
                Older appeals
              </a>
            )}
          </div>
        </>
      )}
    </main>
  );
}
