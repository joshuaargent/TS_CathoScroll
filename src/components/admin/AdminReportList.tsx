'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CommentBanControl } from '@/components/admin/CommentBanControl';
import type { AdminCommentReport } from '@/lib/moderation/types';

const reasonLabels: Record<string, string> = {
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech',
  spam: 'Spam or repeated promotion',
  inappropriate: 'Inappropriate content',
  other: 'Something else',
};

function displayName(profile: AdminCommentReport['reporter']) {
  return profile?.display_name || profile?.username || 'Unknown user';
}

function AdminReportCard({
  report,
  adminUserId,
}: {
  report: AdminCommentReport;
  adminUserId: string;
}) {
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.admin_note ?? '');
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  async function review(action: 'dismiss' | 'resolve' | 'hide') {
    if (action === 'hide' && !window.confirm('Hide this comment from public discussions?')) {
      return;
    }

    setError('');
    setBusyAction(action);

    try {
      const response = await fetch(`/api/admin/reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      const result = (await response.json()) as { error?: string; status?: string };

      if (!response.ok) {
        setError(result.error ?? 'Unable to update this report.');
        return;
      }

      setStatus(result.status ?? status);
    } catch (requestError) {
      console.error('Unable to review comment report:', requestError);
      setError('Unable to update this report. Please try again.');
    } finally {
      setBusyAction('');
    }
  }

  return (
    <article className="border-border space-y-4 rounded-2xl border p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{reasonLabels[report.reason] ?? report.reason}</p>
          <p className="text-text-muted mt-1 text-xs">
            Reported {new Date(report.created_at).toLocaleString('en-GB')} by{' '}
            {displayName(report.reporter)}
          </p>
        </div>
        <span className="bg-bg-secondary rounded-full px-3 py-1 text-xs font-medium capitalize">
          {status}
        </span>
      </header>

      {report.details && (
        <p className="text-text-secondary bg-bg-secondary rounded-xl p-4 text-sm">
          {report.details}
        </p>
      )}

      {report.comment ? (
        <div className="border-border rounded-xl border p-4">
          <p className="text-text-muted text-xs">
            Comment by{' '}
            {report.comment.author?.username ? (
              <Link
                href={`/profile/${encodeURIComponent(report.comment.author.username)}`}
                className="text-accent hover:underline"
              >
                {displayName(report.comment.author)}
              </Link>
            ) : (
              displayName(report.comment.author)
            )}
          </p>
          <p className="mt-2 whitespace-pre-wrap">
            {report.comment.is_deleted ? '[Comment already deleted]' : report.comment.content}
          </p>
          <p className="text-text-secondary mt-3 text-sm">{report.comment.topicTitle}</p>
          {report.comment.topicSlug && (
            <Link
              href={`/topic/${report.comment.topicSlug}#comments`}
              className="text-accent mt-2 inline-block text-sm hover:underline"
            >
              View discussion
            </Link>
          )}
        </div>
      ) : (
        <p className="text-text-muted text-sm">The reported comment is no longer available.</p>
      )}

      {report.comment?.author && (
        <CommentBanControl
          userId={report.comment.author.id}
          activeBan={report.comment.isAuthorCommentBanned}
          reason={report.comment.authorBanReason}
          canChangeBan={report.comment.author.id !== adminUserId}
        />
      )}

      {status === 'pending' || status === 'reviewing' ? (
        <div className="space-y-3">
          <label htmlFor={`report-note-${report.id}`} className="block text-sm font-medium">
            Private admin note (optional)
          </label>
          <textarea
            id={`report-note-${report.id}`}
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
              onClick={() => void review('dismiss')}
              disabled={Boolean(busyAction)}
              className="border-border rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            >
              {busyAction === 'dismiss' ? 'Saving...' : 'Dismiss'}
            </button>
            <button
              type="button"
              onClick={() => void review('resolve')}
              disabled={Boolean(busyAction)}
              className="bg-accent rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busyAction === 'resolve' ? 'Saving...' : 'Resolve'}
            </button>
            <button
              type="button"
              onClick={() => void review('hide')}
              disabled={Boolean(busyAction)}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busyAction === 'hide' ? 'Hiding...' : 'Hide comment & resolve'}
            </button>
          </div>
        </div>
      ) : (
        report.admin_note && (
          <p className="text-text-muted text-sm">
            Admin note: <span className="text-text-secondary">{report.admin_note}</span>
          </p>
        )
      )}
    </article>
  );
}

export function AdminReportList({
  reports,
  adminUserId,
}: {
  reports: AdminCommentReport[];
  adminUserId: string;
}) {
  if (reports.length === 0) {
    return (
      <article className="border-border rounded-2xl border p-6">
        <p className="text-text-secondary">No comment reports to show.</p>
      </article>
    );
  }

  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <AdminReportCard key={report.id} report={report} adminUserId={adminUserId} />
      ))}
    </div>
  );
}
