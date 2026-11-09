'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Comment, Profile } from '../../lib/supabase/types';

import { createClient } from '@/lib/supabase/client';

import { CommentCard } from './CommentCard';
import { CommentForm } from './CommentForm';
import Link from 'next/link';

interface CommentSectionProps {
  topicId: string;
}

const fallbackProfile: Profile = {
  id: '',
  username: 'unknown',
  display_name: 'Unknown User',
  bio: null,
  created_at: '',
  subscription_tier: 'free',
};

/**
 * Counts every node in the nested comment tree, not just its top-level posts.
 *
 * AQA-style pseudocode:
 * FUNCTION countComments(nodes)
 *   total ← 0
 *   FOR EACH node IN nodes
 *     total ← total + 1 + countComments(node.replies)
 *   RETURN total
 * END FUNCTION
 *
 * Every comment is visited once (O(n)); recursive call depth is the maximum
 * reply depth.
 */
function countComments(comments: Comment[]): number {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies), 0);
}

/**
 * Recursively creates a new tree while applying an update only to the node
 * whose id matches. New arrays/ancestor objects keep React state updates
 * immutable without changing unrelated comment values.
 *
 * AQA-style pseudocode:
 * FUNCTION updateCommentTree(nodes, targetId, updater)
 *   updatedNodes ← empty list
 *   FOR EACH node IN nodes
 *     IF node.id = targetId THEN
 *       APPEND updater(node) TO updatedNodes
 *     ELSE
 *       APPEND COPY(node, replies = updateCommentTree(node.replies, targetId, updater))
 *         TO updatedNodes
 *   RETURN updatedNodes
 * END FUNCTION
 */
function updateCommentTree(
  comments: Comment[],
  commentId: number,
  updater: (comment: Comment) => Comment
): Comment[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      return updater(comment);
    }

    return {
      ...comment,
      replies: updateCommentTree(comment.replies, commentId, updater),
    };
  });
}

function insertReplyIntoTree(comments: Comment[], parentId: number, reply: Comment): Comment[] {
  // Recursively map each branch, inserting the reply at the start of the
  // matching parent's child list.
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return {
        ...comment,
        replies: [reply, ...comment.replies],
      };
    }

    return {
      ...comment,
      replies: insertReplyIntoTree(comment.replies, parentId, reply),
    };
  });
}

// Replaces a temporary client-side id after the insert succeeds, including if
// the optimistic item is nested inside a reply branch.
function replaceCommentId(comments: Comment[], tempId: number, realId: number): Comment[] {
  return comments.map((comment) => {
    const updated =
      comment.id === tempId
        ? {
            ...comment,
            id: realId,
            optimistic: false,
          }
        : comment;

    return {
      ...updated,
      replies: replaceCommentId(updated.replies, tempId, realId),
    };
  });
}

function cloneAndSortComments(comments: Comment[], sorter: (comments: Comment[]) => void) {
  // sortComments mutates arrays, so clone the nested state tree before sorting.
  const cloned = structuredClone(comments);

  sorter(cloned);

  return cloned;
}

export function CommentSection({ topicId }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);

  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<string | null>(null);

  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  const [canPinComments, setCanPinComments] = useState(false);

  const [isCommentBanned, setIsCommentBanned] = useState(false);

  const [commentBanCheckFailed, setCommentBanCheckFailed] = useState(false);

  const [pinError, setPinError] = useState('');

  const [pinningCommentId, setPinningCommentId] = useState<number | null>(null);

  const commentCount = useMemo(() => countComments(comments), [comments]);

  const hasPinnedComment = comments.some((comment) => comment.is_pinned);

  const sortComments = useCallback((comments: Comment[]) => {
    // Apply the same ordering independently at each level: pinned first,
    // then most-liked, then newest. This function sorts in place; state updates
    // use cloneAndSortComments to avoid mutating the existing React state tree.
    comments.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }

      if (a.likes !== b.likes) {
        return b.likes - a.likes;
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    comments.forEach((comment) => sortComments(comment.replies));
  }, []);

  const loadComments = useCallback(async () => {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setUserId(user?.id ?? null);

    const commentsResult = await supabase
      .from('comments')
      .select('*')
      .eq('topic_id', topicId)
      .order('created_at', {
        ascending: false,
      });

    const commentRows = commentsResult.data ?? [];

    const userIds = [
      ...new Set([...commentRows.map((row) => row.user_id), user?.id].filter(Boolean)),
    ];

    const [likesResult, profilesResult, adminRoleResult, commentBanResult] = await Promise.all([
      supabase.from('comment_likes').select('comment_id,user_id'),

      userIds.length
        ? supabase.from('profiles').select('*').in('id', userIds)
        : Promise.resolve({
            data: [],
          }),

      user
        ? supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      user
        ? supabase
            .from('user_comment_bans')
            .select('id')
            .eq('user_id', user.id)
            .is('unbanned_at', null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (adminRoleResult.error) {
      console.error('Unable to verify comment moderation role:', adminRoleResult.error.message);
      setCanPinComments(false);
    } else {
      setCanPinComments(Boolean(adminRoleResult.data));
    }

    if (commentBanResult.error) {
      console.error('Unable to check comment restriction:', commentBanResult.error.message);
      setIsCommentBanned(false);
      setCommentBanCheckFailed(true);
    } else {
      setIsCommentBanned(Boolean(commentBanResult.data));
      setCommentBanCheckFailed(false);
    }

    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));

    if (user?.id && !profiles.has(user.id)) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();

      if (data) {
        profiles.set(user.id, data);
      }
    }

    if (user?.id) {
      setCurrentProfile(profiles.get(user.id) ?? null);
    }

    const likeCounts = new Map<number, number>();

    const likedByUser = new Set<number>();

    (likesResult.data ?? []).forEach((like) => {
      likeCounts.set(like.comment_id, (likeCounts.get(like.comment_id) ?? 0) + 1);

      if (like.user_id === user?.id) {
        likedByUser.add(like.comment_id);
      }
    });

    const map = new Map<number, Comment>();

    const roots: Comment[] = [];

    // Build every node before linking parents. This lets a reply find its
    // parent regardless of the order in which the database returned rows.
    //
    // AQA-style pseudocode:
    // FOR EACH row IN commentRows
    //   node ← COMMENT(row, replies = [])
    //   map[row.id] ← node
    // FOR EACH node IN map
    //   IF node.parent_id = NULL THEN
    //     APPEND node TO roots
    //   ELSE IF map CONTAINS node.parent_id THEN
    //     APPEND node TO map[node.parent_id].replies
    // Each database row is processed twice, with average O(1) map access, so
    // constructing the tree takes O(n) time and O(n) additional space.
    commentRows.forEach((row) => {
      map.set(row.id, {
        id: row.id,
        topic_id: row.topic_id,
        user_id: row.user_id,
        parent_id: row.parent_id,
        content: row.content,
        created_at: row.created_at,
        edited_at: row.edited_at,
        is_deleted: row.is_deleted,
        is_pinned: row.is_pinned,

        profile: profiles.get(row.user_id) ?? {
          ...fallbackProfile,
          id: row.user_id,
        },

        likes: likeCounts.get(row.id) ?? 0,

        likedByUser: likedByUser.has(row.id),

        replies: [],
      });
    });

    // The parent_id field is an adjacency-list representation in storage;
    // this pass materializes it as the nested tree consumed by CommentCard.
    map.forEach((comment) => {
      if (comment.parent_id === null) {
        roots.push(comment);

        return;
      }

      map.get(comment.parent_id)?.replies.push(comment);
    });

    sortComments(roots);

    setComments(roots);

    setLoading(false);
  }, [topicId, sortComments]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadComments();
  }, [loadComments]);

  async function createComment(content: string) {
    if (!userId || !currentProfile) {
      return;
    }

    // Show a temporary comment immediately, then replace its temporary id
    // with the database id; reload the authoritative tree if insertion fails.
    const tempId = -Date.now();

    const tempComment: Comment = {
      id: tempId,
      user_id: userId,
      topic_id: topicId,
      parent_id: null,
      content,
      created_at: new Date().toISOString(),
      edited_at: null,
      is_deleted: false,
      is_pinned: false,
      profile: currentProfile,
      likes: 0,
      likedByUser: false,
      replies: [],
      optimistic: true,
    };

    setComments((prev) => cloneAndSortComments([tempComment, ...prev], sortComments));

    const supabase = createClient();

    const { data, error } = await supabase
      .from('comments')
      .insert({
        topic_id: topicId,
        user_id: userId,
        content,
        parent_id: null,
      })
      .select()
      .single();

    if (error || !data) {
      await loadComments();

      return;
    }

    setComments((prev) => replaceCommentId(prev, tempId, data.id));
  }

  async function createReply(parentId: number, content: string) {
    if (!userId || !currentProfile) {
      return;
    }

    // Reply creation uses the same optimistic insert/reconcile flow, but first
    // locates the parent in the nested client-side tree.
    const tempId = -Date.now();

    const tempReply: Comment = {
      id: tempId,
      user_id: userId,
      topic_id: topicId,
      parent_id: parentId,
      content,
      created_at: new Date().toISOString(),
      edited_at: null,
      is_deleted: false,
      is_pinned: false,
      profile: currentProfile,
      likes: 0,
      likedByUser: false,
      replies: [],
      optimistic: true,
    };

    setComments((prev) => insertReplyIntoTree(prev, parentId, tempReply));

    const supabase = createClient();

    const { data, error } = await supabase
      .from('comments')
      .insert({
        topic_id: topicId,
        user_id: userId,
        parent_id: parentId,
        content,
      })
      .select()
      .single();

    if (error || !data) {
      await loadComments();

      return;
    }

    setComments((prev) => replaceCommentId(prev, tempId, data.id));
  }

  async function editComment(commentId: number, content: string) {
    const editedAt = new Date().toISOString();

    // Update the visible tree immediately; reload it from Supabase if the
    // persistent update fails so the UI returns to the saved value.
    setComments((prev) =>
      updateCommentTree(prev, commentId, (comment) => ({
        ...comment,
        content,
        edited_at: editedAt,
      }))
    );

    const supabase = createClient();

    const { error } = await supabase
      .from('comments')
      .update({
        content,
        edited_at: editedAt,
      })
      .eq('id', commentId);

    if (error) {
      await loadComments();
    }
  }

  async function deleteComment(commentId: number) {
    if (!window.confirm('Delete this comment?')) {
      return;
    }

    setComments((prev) =>
      updateCommentTree(prev, commentId, (comment) => ({
        ...comment,
        is_deleted: true,
      }))
    );

    const supabase = createClient();

    const { error } = await supabase
      .from('comments')
      .update({
        is_deleted: true,
      })
      .eq('id', commentId);

    if (error) {
      await loadComments();
    }
  }

  async function togglePin(commentId: number) {
    if (!canPinComments) {
      return;
    }

    const selectedComment = comments.find((comment) => comment.id === commentId);

    if (!selectedComment || selectedComment.parent_id !== null) {
      return;
    }

    const shouldPin = !selectedComment.is_pinned;

    setPinError('');
    setPinningCommentId(commentId);
    setComments((previous) =>
      cloneAndSortComments(
        previous.map((comment) => ({
          ...comment,
          is_pinned: shouldPin && comment.id === commentId,
        })),
        sortComments
      )
    );

    try {
      const response = await fetch(`/api/admin/comments/${commentId}/pin`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinned: shouldPin }),
      });

      if (!response.ok) {
        throw new Error(`Pin request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Unable to update pinned comment:', error);
      setPinError('Unable to update the pinned comment. Please try again.');
      await loadComments();
    } finally {
      setPinningCommentId(null);
    }
  }

  async function reportComment(commentId: number, reason: string, details: string) {
    const response = await fetch('/api/reports/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ commentId, reason, details }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(result?.error ?? 'Unable to submit your report. Please try again.');
    }
  }

  function findComment(comments: Comment[], id: number): Comment | undefined {
    // Depth-first search: check each comment, then recursively inspect its
    // replies before moving to the next sibling.
    //
    // AQA-style pseudocode:
    // FUNCTION findComment(nodes, targetId)
    //   FOR EACH node IN nodes
    //     IF node.id = targetId THEN RETURN node
    //     result ← findComment(node.replies, targetId)
    //     IF result EXISTS THEN RETURN result
    //   RETURN NOT FOUND
    // Worst-case time: O(n); recursive call depth is the maximum reply depth.
    for (const comment of comments) {
      if (comment.id === id) {
        return comment;
      }

      const reply = findComment(comment.replies, id);

      if (reply) {
        return reply;
      }
    }

    return undefined;
  }

  async function toggleLike(commentId: number) {
    if (!userId) {
      return;
    }

    const comment = findComment(comments, commentId);

    if (!comment) {
      return;
    }

    // Update the selected node and its like count optimistically; a failed
    // database mutation is reconciled by reloading the comment tree.
    const wasLiked = comment.likedByUser;

    setComments((prev) =>
      cloneAndSortComments(
        updateCommentTree(prev, commentId, (comment) => ({
          ...comment,
          likedByUser: !wasLiked,
          likes: wasLiked ? Math.max(0, comment.likes - 1) : comment.likes + 1,
        })),
        sortComments
      )
    );

    const supabase = createClient();

    let error = null;

    if (wasLiked) {
      ({ error } = await supabase
        .from('comment_likes')
        .delete()
        .eq('user_id', userId)
        .eq('comment_id', commentId));
    } else {
      ({ error } = await supabase.from('comment_likes').insert({
        user_id: userId,
        comment_id: commentId,
      }));
    }

    if (error) {
      await loadComments();
    }
  }

  if (loading) {
    return (
      <section id="comments" className="mb-16">
        <h2 className="mb-6 text-3xl font-bold">Comments</h2>

        <p>Loading comments...</p>
      </section>
    );
  }

  return (
    <section id="comments" className="mb-16">
      <h2 className="mb-6 text-3xl font-bold">Comments ({commentCount})</h2>

      {userId && (isCommentBanned || commentBanCheckFailed) ? (
        <article className="border-border rounded-2xl border p-6">
          <p className="font-semibold">
            {isCommentBanned
              ? 'You can’t post or reply to comments right now.'
              : 'Unable to verify whether you can comment right now.'}
          </p>
          <p className="text-text-secondary mt-2">
            {isCommentBanned
              ? 'You can still read discussions and ask an admin to review this restriction.'
              : 'Posting is disabled until your comment access can be verified. Please refresh the page.'}
          </p>
          {isCommentBanned && (
            <Link
              href="/appeal"
              className="text-accent mt-4 inline-block font-medium hover:underline"
            >
              Request a review
            </Link>
          )}
        </article>
      ) : userId ? (
        <>
          <CommentForm onSubmit={createComment} />

          <div className="h-6" />
        </>
      ) : (
        <>
          <article className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">Sign in to join the discussion.</p>
          </article>

          <div className="h-6" />
        </>
      )}

      {pinError && (
        <p role="alert" className="mb-6 text-sm text-red-600">
          {pinError}
        </p>
      )}

      {comments.length === 0 ? (
        <article className="border-border rounded-2xl border p-6">
          <p className="font-medium">No comments yet.</p>

          <p className="text-text-secondary mt-2">
            Be the first to share your thoughts on this topic.
          </p>
        </article>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              currentUserId={userId}
              onReply={createReply}
              onLike={toggleLike}
              onEdit={editComment}
              onDelete={deleteComment}
              onReport={reportComment}
              onPin={togglePin}
              canPin={canPinComments}
              isCommentBanned={isCommentBanned || commentBanCheckFailed}
              hasPinnedComment={hasPinnedComment}
              isPinning={pinningCommentId === comment.id}
              pinActionPending={pinningCommentId !== null}
            />
          ))}
        </div>
      )}
    </section>
  );
}
