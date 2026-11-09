'use client';

import { useState } from 'react';

import type { AdminCommentBanAppeal, AdminUserComment } from '@/lib/moderation/types';

function AppealCard({ appeal }: { appeal: AdminCommentBanAppeal }) {
  const [status, setStatus] = useState(appeal.status);
  const [note, setNote] = useState(appeal.admin_note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AdminUserComment[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function loadHistory(offset: number) {
    setHistoryLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/admin/users/${appeal.user_id}/comments?offset=${offset}&limit=30`
      );
      const result = (await response.json()) as {
        comments?: AdminUserComment[];
        nextOffset?: number | null;
        error?: string;
      };

      if (!response.ok) {
        setError(result.error ?? 'Unable to load comment history.');
        return;
      }

      const comments = result.comments ?? [];
      setHistory((previous) => (offset === 0 ? comments : [...previous, ...comments]));
      setHistoryOffset(result.nextOffset ?? 0);
      setHistoryHasMore(result.nextOffset !== null && result.nextOffset !== undefined);
      setHistoryOpen(true);
    } catch (requestError) {
      console.error('Unable to load appeal comment history:', requestError);
      setError('Unable to load comment history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function decide(decision: 'approve' | 'dismiss') {
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`/api/admin/comment-ban-appeals/${appeal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const result = (await response.json()) as { status?: string; error?: string };

      if (!response.ok) {
        setError(result.error ?? 'Unable to review this appeal.');
        return;
      }

      setStatus(result.status ?? status);
    } catch (requestError) {
      console.error('Unable to review comment-ban appeal:', requestError);
      setError('Unable to review this appeal. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const name = appeal.profile?.display_name || appeal.profile?.username || 'Unknown user';

  return (
    <article className="border-border space-y-4 rounded-2xl border p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-text-muted mt-1 text-xs">
            Appeal submitted {new Date(appeal.created_at).toLocaleString('en-GB')} ·{' '}
            {appeal.profile?.username ? `@${appeal.profile.username}` : appeal.user_id}
          </p>
        </div>
        <span className="bg-bg-secondary rounded-full px-3 py-1 text-xs font-medium capitalize">
          {status}
        </span>
      </header>

      <div className="bg-bg-secondary rounded-xl p-4">
        <p className="text-text-muted mb-2 text-xs">User’s appeal</p>
        <p className="whitespace-pre-wrap">{appeal.message}</p>
      </div>

      {appeal.banReason && (
        <p className="text-text-secondary text-sm">
          Original restriction reason: {appeal.banReason}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => {
            if (historyOpen) {
              setHistoryOpen(false);
            } else if (history.length === 0) {
              void loadHistory(0);
            } else {
              setHistoryOpen(true);
            }
          }}
          className="text-accent text-sm font-medium hover:underline"
        >
          {historyLoading
            ? 'Loading comments...'
            : historyOpen
              ? 'Hide comment history'
              : 'Review all comments and replies'}
        </button>

        {historyOpen && (
          <div className="mt-4 space-y-3">
            {history.map((comment) => (
              <article key={comment.id} className="border-border rounded-xl border p-4">
                <p className="text-text-muted text-xs">{comment.topicTitle}</p>
                <p className="mt-2 whitespace-pre-wrap">
                  {comment.is_deleted ? '[Deleted comment]' : comment.content}
                </p>
                {comment.parent && (
                  <blockquote className="border-border text-text-secondary mt-3 border-l-2 pl-3 text-sm">
                    Reply to {comment.parent.profile?.display_name ?? 'another user'}:{' '}
                    {comment.parent.content}
                  </blockquote>
                )}
                <p className="text-text-muted mt-2 text-xs">
                  {new Date(comment.created_at).toLocaleString('en-GB')}
                  {comment.edited_at ? ' · edited' : ''}
                </p>
              </article>
            ))}
            {historyHasMore && (
              <button
                type="button"
                onClick={() => void loadHistory(historyOffset)}
                disabled={historyLoading}
                className="border-border rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              >
                {historyLoading ? 'Loading...' : 'Load more comments'}
              </button>
            )}
          </div>
        )}
      </div>

      {status === 'pending' ? (
        <div className="space-y-3">
          <label htmlFor={`appeal-note-${appeal.id}`} className="block text-sm font-medium">
            Private admin note (optional)
          </label>
          <textarea
            id={`appeal-note-${appeal.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={2}
            className="border-border bg-background w-full resize-y rounded-lg border p-3 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void decide('dismiss')}
              disabled={busy}
              className="border-border rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Keep restriction'}
            </button>
            <button
              type="button"
              onClick={() => void decide('approve')}
              disabled={busy}
              className="bg-accent rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Approve appeal & lift restriction'}
            </button>
          </div>
        </div>
      ) : (
        appeal.admin_note && (
          <p className="text-text-muted text-sm">
            Admin note: <span className="text-text-secondary">{appeal.admin_note}</span>
          </p>
        )
      )}
    </article>
  );
}

export function AdminAppealList({ appeals }: { appeals: AdminCommentBanAppeal[] }) {
  if (appeals.length === 0) {
    return (
      <article className="border-border rounded-2xl border p-6">
        <p className="text-text-secondary">No comment-ban appeals to show.</p>
      </article>
    );
  }

  return (
    <div className="space-y-4">
      {appeals.map((appeal) => (
        <AppealCard key={appeal.id} appeal={appeal} />
      ))}
    </div>
  );
}
