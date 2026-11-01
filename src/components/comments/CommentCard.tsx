'use client';

import { useState } from 'react';

import { Pin } from 'lucide-react';

import { Comment } from '../../lib/supabase/types';

import { CommentForm } from './CommentForm';

import Link from 'next/link';

interface CommentCardProps {
  comment: Comment;

  currentUserId: string | null;

  currentUsername?: string;

  depth?: number;

  onReply: (parentId: number, content: string) => Promise<void>;

  onLike: (commentId: number) => Promise<void>;

  onEdit: (commentId: number, content: string) => Promise<void>;

  onDelete: (commentId: number) => Promise<void>;

  onPin?: (commentId: number) => Promise<void>;

  hasPinnedComment?: boolean;
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
  currentUsername,
  depth = 0,
  onReply,
  onLike,
  onEdit,
  onDelete,
  onPin,
  hasPinnedComment = false,
}: CommentCardProps) {
  const [showReply, setShowReply] = useState(false);

  const [isEditing, setIsEditing] = useState(false);

  const isOwner = currentUserId === comment.user_id;

  const canReply = depth < 2;

  const canPin = currentUsername === 'joshua_argent' || currentUsername === 'admin';

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
                  await onEdit(comment.id, content);

                  setIsEditing(false);
                }}
                onCancel={() => setIsEditing(false)}
              />
            ) : (
              <p className="leading-relaxed">{comment.content}</p>
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

              {!isEditing && canReply && currentUserId && (
                <button
                  type="button"
                  onClick={() => setShowReply(!showReply)}
                  className="text-text-secondary hover:text-text-primary"
                >
                  Reply
                </button>
              )}

              {isOwner && (
                <>
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
                  className="text-text-secondary hover:text-text-primary"
                >
                  {comment.is_pinned ? 'Unpin' : 'Pin'}
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
              currentUsername={currentUsername}
              depth={depth + 1}
              onReply={onReply}
              onLike={onLike}
              onEdit={onEdit}
              onDelete={onDelete}
              onPin={onPin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
