'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AdminUserComment } from '@/lib/moderation/types';

interface CommentBanControlProps {
  userId: string;
  activeBan: boolean;
  reason?: string | null;
  canChangeBan: boolean;
}

export function CommentBanControl({
  userId,
  activeBan,
  reason,
  canChangeBan,
}: CommentBanControlProps) {
  const router = useRouter();
  const [restrictionActive, setRestrictionActive] = useState(activeBan);
  const [moderationReason, setModerationReason] = useState('');
  const [hideExistingComments, setHideExistingComments] = useState(false);
  const [restoreHiddenComments, setRestoreHiddenComments] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AdminUserComment[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  if (!canChangeBan) {
    return null;
  }

  async function loadHistory(offset: number) {
    setError('');
    setHistoryLoading(true);

    try {
      // Fetch one bounded page and append it to the already loaded history.
      // AQA-style pseudocode:
      // GET comments[offset TO offset + pageSize]
      // APPEND returned comments to history
      // IF more comments exist THEN store next offset
      // Each request processes at most 30 comments; total history is loaded on demand.
      const response = await fetch(`/api/admin/users/${userId}/comments?offset=${offset}&limit=30`);
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
      console.error('Unable to load user comment history:', requestError);
      setError('Unable to load comment history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function updateRestriction() {
    // Apply the restriction and optional content hiding through one database
    // function so a partial failure cannot leave only one action committed.
    if (
      !restrictionActive &&
      hideExistingComments &&
      !window.confirm(
        'Hide all currently visible comments and replies from this user? They will remain in admin history.'
      )
    ) {
      return;
    }

    setError('');
    setSaving(true);

    try {
      const response = await fetch('/api/admin/comment-bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: restrictionActive ? 'unban' : 'ban',
          userId,
          reason: moderationReason,
          hideExistingComments,
          restoreHiddenComments,
        }),
      });
      const result = (await response.json()) as { error?: string; banned?: boolean };

      if (!response.ok) {
        setError(result.error ?? 'Unable to update comment access.');
        return;
      }

      setRestrictionActive(Boolean(result.banned));
      setModerationReason('');
      setHideExistingComments(false);
      setRestoreHiddenComments(true);
      router.refresh();
    } catch (requestError) {
      console.error('Unable to update comment restriction:', requestError);
      setError('Unable to update comment access. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="border-border mt-6 rounded-2xl border p-5">
      <h2 className="font-bold">Comment access</h2>
      <p className="text-text-secondary mt-2 text-sm">
        {restrictionActive
          ? 'This user is currently unable to post or reply to comments.'
          : 'This user can currently post and reply to comments.'}
      </p>
      {restrictionActive && reason && (
        <p className="text-text-muted mt-2 text-sm">Restriction reason: {reason}</p>
      )}
      {restrictionActive && (
        <div className="mt-4">
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
                : 'Review all comments and replies before lifting'}
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
      )}
      {!restrictionActive && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={hideExistingComments}
            onChange={(event) => setHideExistingComments(event.target.checked)}
            className="accent-accent mt-1"
          />
          <span>
            <span className="font-medium">Also hide existing comments and replies</span>
            <span className="text-text-muted mt-1 block">
              This soft-deletes visible comments from public discussion but keeps them in admin
              history.
            </span>
          </span>
        </label>
      )}
      {restrictionActive && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={restoreHiddenComments}
            onChange={(event) => setRestoreHiddenComments(event.target.checked)}
            className="accent-accent mt-1"
          />
          <span>
            <span className="font-medium">Restore comments hidden by this restriction</span>
            <span className="text-text-muted mt-1 block">
              Only comments that were visible when the restriction was applied can be restored.
            </span>
          </span>
        </label>
      )}
      <label
        htmlFor={`moderation-reason-${userId}`}
        className="mt-4 mb-2 block text-sm font-medium"
      >
        {restrictionActive ? 'Reason for lifting the restriction' : 'Reason for restriction'}
      </label>
      <textarea
        id={`moderation-reason-${userId}`}
        value={moderationReason}
        onChange={(event) => setModerationReason(event.target.value)}
        maxLength={1000}
        rows={3}
        className="border-border bg-background w-full resize-y rounded-lg border p-3 text-sm"
        placeholder="This reason is recorded for admin review."
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void updateRestriction()}
        disabled={saving || moderationReason.trim().length < 5}
        className={`mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
          restrictionActive ? 'bg-accent' : 'bg-red-600'
        }`}
      >
        {saving
          ? 'Saving...'
          : restrictionActive
            ? 'Lift comment restriction'
            : 'Restrict commenting'}
      </button>
    </article>
  );
}
