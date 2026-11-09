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
        }),
      });
      const result = (await response.json()) as { error?: string; banned?: boolean };

      if (!response.ok) {
        setError(result.error ?? 'Unable to update comment access.');
        return;
      }

      setRestrictionActive(Boolean(result.banned));
      setModerationReason('');
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
