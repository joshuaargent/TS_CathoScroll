'use client';

import { useState } from 'react';

import { Flag, Pin } from 'lucide-react';

import { Comment } from '../../lib/supabase/types';

import { CommentForm } from './CommentForm';

import Link from 'next/link';

interface CommentCardProps {
  comment: Comment;

  currentUserId: string | null;

  depth?: number;

  onReply: (parentId: number, content: string) => Promise<void>;

  onLike: (commentId: number) => Promise<void>;

  onEdit: (commentId: number, content: string) => Promise<void>;

  onDelete: (commentId: number) => Promise<void>;

  onReport: (commentId: number, reason: string, details: string) => Promise<void>;

  onPin?: (commentId: number) => Promise<void>;

  canPin?: boolean;

  isCommentBanned?: boolean;

  hasPinnedComment?: boolean;

  isPinning?: boolean;

  pinActionPending?: boolean;
}

function formatRelativeDate(dateString: string) {
  const date = new Date(dateString);

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) {
    return 'Just now';
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function CommentCard({
  comment,
  currentUserId,
  depth = 0,
  onReply,
  onLike,
  onEdit,
  onDelete,
  onReport,
  onPin,
  canPin = false,
  isCommentBanned = false,
  hasPinnedComment = false,
  isPinning = false,
  pinActionPending = false,
}: CommentCardProps) {
  const [showReply, setShowReply] = useState(false);

  const [isEditing, setIsEditing] = useState(false);

  const [editError, setEditError] = useState('');

  const [showReport, setShowReport] = useState(false);

  const [reportReason, setReportReason] = useState('harassment');

  const [reportDetails, setReportDetails] = useState('');

  const [reportError, setReportError] = useState('');

  const [reportSubmitted, setReportSubmitted] = useState(false);

  const [isReporting, setIsReporting] = useState(false);

  const isOwner = currentUserId === comment.user_id;

  const canReply = depth < 2;

  const canShowPinButton =
    canPin && comment.parent_id === null && (comment.is_pinned || !hasPinnedComment);

  return (
    <div className="space-y-4">
      <article className="border-border rounded-2xl border p-6">
        <div className="mb-4">
          {comment.is_pinned && (
            <div className="mb-3">
              <span className="bg-accent-light text-accent inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium">
                <Pin className="h-3 w-3" />
                Pinned
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/profile/${comment.profile.username}`}
              className="hover:text-accent font-semibold transition-colors"
            >
              {comment.profile.display_name}
            </Link>

            {isOwner && (
              <span className="bg-accent-light text-accent rounded-full px-2 py-0.5 text-xs font-medium">
                You
              </span>
            )}
          </div>

          <div className="text-text-muted mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span>{formatRelativeDate(comment.created_at)}</span>

            {comment.edited_at && (
              <>
                <span>•</span>

                <span>edited</span>
              </>
            )}
          </div>
        </div>

        {comment.is_deleted ? (
          <p className="text-text-muted italic">This comment has been deleted.</p>
        ) : (
          <>
            {isEditing ? (
              <CommentForm
                initialValue={comment.content}
                submitLabel="Save"
                onSubmit={async (content) => {
                  setEditError('');

                  try {
                    await onEdit(comment.id, content);
                    setIsEditing(false);
                  } catch (error) {
                    setEditError(
                      error instanceof Error ? error.message : 'Unable to update this comment.'
                    );
                  }
                }}
                onCancel={() => setIsEditing(false)}
              />
            ) : (
              <p className="leading-relaxed">{comment.content}</p>
            )}

            {editError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {editError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => onLike(comment.id)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  comment.likedByUser ? 'bg-accent text-white' : 'bg-accent-light text-accent'
                }`}
              >
                ♥ {comment.likes}
              </button>

              {!isEditing && canReply && currentUserId && !isCommentBanned && (
                <button
                  type="button"
                  onClick={() => setShowReply(!showReply)}
                  className="text-text-secondary hover:text-text-primary"
                >
                  Reply
                </button>
              )}

              {currentUserId && !isOwner && !comment.is_deleted && (
                <button
                  type="button"
                  onClick={() => {
                    setShowReport(!showReport);
                    setReportError('');
                  }}
                  className="text-text-secondary hover:text-text-primary inline-flex items-center gap-1"
                >
                  <Flag className="h-4 w-4" />
                  Report
                </button>
              )}

              {isOwner && (
                <>
                  {!isCommentBanned && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowReply(false);

                        setIsEditing(!isEditing);
                      }}
                      className="text-text-secondary hover:text-text-primary"
                    >
                      Edit
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDelete(comment.id)}
                    className="text-text-secondary hover:text-text-primary"
                  >
                    Delete
                  </button>
                </>
              )}
              {!comment.is_deleted && canShowPinButton && (
                <button
                  type="button"
                  onClick={() => onPin?.(comment.id)}
                  disabled={pinActionPending}
                  className="text-text-secondary hover:text-text-primary"
                >
                  {isPinning ? 'Updating...' : comment.is_pinned ? 'Unpin' : 'Pin'}
                </button>
              )}
            </div>

            {showReply && !isEditing && (
              <div className="mt-6">
                <CommentForm
                  submitLabel="Reply"
                  onSubmit={async (content) => {
                    await onReply(comment.id, content);

                    setShowReply(false);
                  }}
                  onCancel={() => setShowReply(false)}
                />
              </div>
            )}

            {showReport && !reportSubmitted && (
              <form
                className="border-border mt-5 space-y-3 rounded-xl border p-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setIsReporting(true);
                  setReportError('');

                  try {
                    await onReport(comment.id, reportReason, reportDetails.trim());
                    setReportSubmitted(true);
                  } catch (error) {
                    setReportError(
                      error instanceof Error ? error.message : 'Unable to submit your report.'
                    );
                  } finally {
                    setIsReporting(false);
                  }
                }}
              >
                <label
                  className="block text-sm font-medium"
                  htmlFor={`report-reason-${comment.id}`}
                >
                  Why are you reporting this comment?
                </label>
                <select
                  id={`report-reason-${comment.id}`}
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                  className="border-border bg-background w-full rounded-lg border px-3 py-2"
                >
                  <option value="harassment">Harassment or bullying</option>
                  <option value="hate_speech">Hate speech</option>
                  <option value="spam">Spam or repeated promotion</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="other">Something else</option>
                </select>
                <label
                  className="block text-sm font-medium"
                  htmlFor={`report-details-${comment.id}`}
                >
                  Additional context (optional)
                </label>
                <textarea
                  id={`report-details-${comment.id}`}
                  value={reportDetails}
                  onChange={(event) => setReportDetails(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  className="border-border bg-background w-full resize-y rounded-lg border p-3"
                  placeholder="Explain what happened, if useful."
                />
                <p className="text-text-muted text-xs">
                  Reports are private to admins. Don’t report a comment just because you disagree;
                  knowingly false or abusive reports may lead to restrictions.
                </p>
                {reportError && (
                  <p role="alert" className="text-sm text-red-600">
                    {reportError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReport(false)}
                    disabled={isReporting}
                    className="border-border rounded-lg border px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isReporting}
                    className="bg-accent rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {isReporting ? 'Sending...' : 'Submit report'}
                  </button>
                </div>
              </form>
            )}

            {reportSubmitted && (
              <p role="status" className="text-text-secondary mt-4 text-sm">
                Thanks. Your report was sent privately to the moderation team.
              </p>
            )}
          </>
        )}
      </article>

      {comment.replies.length > 0 && (
        <div className="border-border ml-6 space-y-4 border-l pl-6">
          {comment.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              depth={depth + 1}
              onReply={onReply}
              onLike={onLike}
              onEdit={onEdit}
              onDelete={onDelete}
              onReport={onReport}
              onPin={onPin}
              canPin={canPin}
              isCommentBanned={isCommentBanned}
              hasPinnedComment={hasPinnedComment}
              isPinning={isPinning}
              pinActionPending={pinActionPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
