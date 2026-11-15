'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Comment, Profile } from '../../lib/supabase/types';

import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OfflineCommentCache } from '@/lib/offline/comment-cache';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';

import { CommentCard } from './CommentCard';
import { CommentForm } from './CommentForm';
import Link from 'next/link';
import { siteConfig } from '@/lib/constants';

interface CommentSectionProps {
  topicId: string;
  cache?: Pick<OfflineCommentCache, 'load' | 'save'>;
  serverActionsAvailable?: boolean;
  supabaseClient?: SupabaseClient;
}

interface CommentFeedRow {
  id: number;
  topic_id: string;
  user_id: string;
  parent_id: number | null;
  content: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  is_pinned: boolean;
  likes: number;
  liked_by_user: boolean;
}

interface CommentPageCursor {
  created_at: string;
  id: number;
}

interface CommentPageResult {
  comments: CommentFeedRow[];
  has_more: boolean;
  next_cursor: CommentPageCursor | null;
  total_count: number;
}

const fallbackProfile: Pick<Profile, 'id' | 'username' | 'display_name' | 'bio'> = {
  id: '',
  username: 'unknown',
  display_name: 'Unknown User',
  bio: null,
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
  //
  // AQA-style pseudocode:
  // FUNCTION insertReply(nodes, parentId, reply)
  //   FOR EACH node IN nodes
  //     IF node.id = parentId THEN prepend reply to node.replies
  //     ELSE node.replies ← insertReply(node.replies, parentId, reply)
  //   RETURN copied nodes
  // END FUNCTION
  // The immutable traversal visits each node once: O(n) time and O(n) space.
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
//
// AQA-style pseudocode:
// FUNCTION replaceCommentId(nodes, temporaryId, databaseId)
//   FOR EACH node IN nodes
//     IF node.id = temporaryId THEN replace its id and clear optimistic flag
//     node.replies ← replaceCommentId(node.replies, temporaryId, databaseId)
//   RETURN copied nodes
// END FUNCTION
// Time and additional space are O(n), where n is the total number of comments.
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

function flattenCommentTree(comments: Comment[]): Comment[] {
  const flattened: Comment[] = [];

  function visit(nodes: Comment[]) {
    nodes.forEach((comment) => {
      const { replies, ...commentWithoutReplies } = comment;
      flattened.push({ ...commentWithoutReplies, replies: [] });
      visit(replies);
    });
  }

  visit(comments);
  return flattened;
}

export function CommentSection({
  topicId,
  cache,
  serverActionsAvailable = true,
  supabaseClient,
}: CommentSectionProps) {
  const requestSignIn = useSignInPrompt();
  const getClient = useCallback(() => supabaseClient ?? createClient(), [supabaseClient]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [nextCommentCursor, setNextCommentCursor] = useState<CommentPageCursor | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [totalCommentCount, setTotalCommentCount] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);

  const [isOnline, setIsOnline] = useState(true);

  const [commentLoadError, setCommentLoadError] = useState('');
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState('');

  const [commentActionError, setCommentActionError] = useState('');

  const [userId, setUserId] = useState<string | null>(null);

  const [currentProfile, setCurrentProfile] = useState<Pick<Profile, 'id' | 'username' | 'display_name' | 'bio'> | null>(null);

  const [canPinComments, setCanPinComments] = useState(false);

  const [isCommentBanned, setIsCommentBanned] = useState(false);

  const [commentBanCheckFailed, setCommentBanCheckFailed] = useState(false);

  const [pinError, setPinError] = useState('');

  const [pinningCommentId, setPinningCommentId] = useState<number | null>(null);
  const loadVersion = useRef(0);
  const loadMoreInFlight = useRef(false);

  const loadedCommentCount = useMemo(() => countComments(comments), [comments]);
  const commentCount = totalCommentCount ?? loadedCommentCount;

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
    const version = ++loadVersion.current;
    const isCurrent = () => version === loadVersion.current;
    setLoading(true);
    setLoadingMoreComments(false);
    setLoadMoreError('');
    setHasMoreComments(false);
    setNextCommentCursor(null);
    setTotalCommentCount(null);
    setCommentLoadError('');
    setCacheWarning('');
    try {
      if (cache && !navigator.onLine) throw new Error('Offline');
      const supabase = getClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isCurrent()) return;
      setUserId(user?.id ?? null);

      const commentsResult = await supabase.rpc('get_topic_comment_page', {
        p_topic_id: topicId,
        p_limit: 50,
      });

      if (!isCurrent()) return;
      if (commentsResult.error) {
        throw new Error(`Unable to load comments: ${commentsResult.error.message}`);
      }

      const page = commentsResult.data as CommentPageResult | null;
      if (!page) throw new Error('The comment page response was empty.');
      const commentRows = page.comments ?? [];
      const nextCursor = page.next_cursor ?? null;
      setHasMoreComments(Boolean(page.has_more && nextCursor));
      setNextCommentCursor(nextCursor);
      setTotalCommentCount(Number(page.total_count ?? commentRows.length));
      const userIds = [
        ...new Set(
          [...commentRows.map((row) => row.user_id), user?.id].filter(
            (id): id is string => Boolean(id)
          )
        ),
      ];

      const [profilesResult, adminRoleResult, commentBanResult] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('id,username,display_name,bio').in('id', userIds)
          : Promise.resolve({
              data: [],
              error: null,
            }),

        user
          ? supabase.rpc('is_cathoscroll_content_admin')
          : Promise.resolve({ data: false, error: null }),

        user
          ? supabase
              .from('user_comment_bans')
              .select('id')
              .eq('user_id', user.id)
              .is('unbanned_at', null)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (!isCurrent()) return;
      if (profilesResult.error) {
        throw new Error(`Unable to load comment details: ${profilesResult.error.message}`);
      }

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

      const profiles = new Map<string, Pick<Profile, 'id' | 'username' | 'display_name' | 'bio'>>(
        (profilesResult.data ?? []).map((profile) => [profile.id, profile])
      );

      if (user?.id && !profiles.has(user.id)) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,username,display_name,bio')
          .eq('id', user.id)
          .single();

        if (!isCurrent()) return;
        if (error) {
          throw new Error(`Unable to load your comment profile: ${error.message}`);
        }
        if (data) {
          profiles.set(user.id, data);
        }
      }

      if (user?.id) {
        setCurrentProfile(profiles.get(user.id) ?? null);
      }

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

          likes: Number(row.likes ?? 0),

          likedByUser: Boolean(row.liked_by_user),

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
      setCachedAt(null);
      setCommentLoadError('');
      if (cache) {
        try {
          await cache.save(topicId, roots);
        } catch (error) {
          console.error('Unable to save comments for offline viewing:', error);
          if (isCurrent()) setCacheWarning('Comments could not be saved for offline viewing.');
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (!(cache && !navigator.onLine)) console.error('Unable to load comments:', error);
      if (cache) {
        try {
          const cached = await cache.load(topicId);
          if (!isCurrent()) return;
          if (cached) {
            setComments(cached.comments);
            setCachedAt(cached.savedAt);
            setHasMoreComments(false);
            setNextCommentCursor(null);
            setTotalCommentCount(null);
            setUserId(null);
            setCurrentProfile(null);
            setCanPinComments(false);
            return;
          }
        } catch (cacheError) {
          if (!isCurrent()) return;
          console.error('Unable to open saved comments:', cacheError);
          setCommentLoadError('Unable to open saved comments. Please try again.');
          return;
        }
      }
      setComments([]);
      setCachedAt(null);
      setHasMoreComments(false);
      setNextCommentCursor(null);
      setTotalCommentCount(null);
      setCommentLoadError(
        cache && !navigator.onLine
          ? 'Comments for this topic have not been saved on this device.'
          : 'Unable to load comments. Please try again.'
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [topicId, sortComments, cache, getClient]);

  const loadMoreComments = useCallback(async () => {
    const cursor = nextCommentCursor;
    if (
      !cursor ||
      loadingMoreComments ||
      loadMoreInFlight.current ||
      !isOnline ||
      cachedAt
    ) {
      return;
    }

    loadMoreInFlight.current = true;
    setLoadingMoreComments(true);
    setLoadMoreError('');
    const version = loadVersion.current;

    try {
      const supabase = getClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (version !== loadVersion.current) return;

      const { data, error } = await supabase.rpc('get_topic_comment_page', {
        p_topic_id: topicId,
        p_before_created_at: cursor.created_at,
        p_before_id: cursor.id,
        p_limit: 50,
      });
      if (error) throw error;
      const page = data as CommentPageResult | null;
      if (!page) throw new Error('The next comment page response was empty.');
      if (version !== loadVersion.current) return;

      const existingFlat = flattenCommentTree(comments);
      const profiles = new Map<
        string,
        Pick<Profile, 'id' | 'username' | 'display_name' | 'bio'>
      >();
      existingFlat.forEach((comment) => profiles.set(comment.user_id, comment.profile));
      if (user?.id && currentProfile) profiles.set(user.id, currentProfile);

      const userIds = [
        ...new Set(
          [...page.comments.map((row) => row.user_id), user?.id].filter(
            (id): id is string => Boolean(id)
          )
        ),
      ].filter((id) => !profiles.has(id));

      const [profilesResult, adminRoleResult, commentBanResult] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('id,username,display_name,bio').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
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

      if (version !== loadVersion.current) return;
      if (profilesResult.error) throw profilesResult.error;

      (profilesResult.data ?? []).forEach((profile) => profiles.set(profile.id, profile));

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

      const nodes = new Map<number, Comment>();
      existingFlat.forEach((comment) => {
        nodes.set(comment.id, { ...comment, replies: [] });
      });

      page.comments.forEach((row) => {
        const previous = nodes.get(row.id);
        nodes.set(row.id, {
          id: row.id,
          topic_id: row.topic_id,
          user_id: row.user_id,
          parent_id: row.parent_id,
          content: row.content,
          created_at: row.created_at,
          edited_at: row.edited_at,
          is_deleted: row.is_deleted,
          is_pinned: row.is_pinned,
          profile:
            profiles.get(row.user_id) ??
            previous?.profile ?? {
              ...fallbackProfile,
              id: row.user_id,
            },
          likes: Number(row.likes ?? 0),
          likedByUser: Boolean(row.liked_by_user),
          replies: [],
          ...(previous?.optimistic ? { optimistic: true } : {}),
        });
      });

      const mergedRoots: Comment[] = [];
      nodes.forEach((comment) => {
        if (comment.parent_id === null) {
          mergedRoots.push(comment);
          return;
        }
        nodes.get(comment.parent_id)?.replies.push(comment);
      });

      sortComments(mergedRoots);
      setComments(mergedRoots);
      setUserId(user?.id ?? null);
      setCurrentProfile(user?.id ? profiles.get(user.id) ?? null : null);
      const nextCursor = page.next_cursor ?? null;
      setHasMoreComments(Boolean(page.has_more && nextCursor));
      setNextCommentCursor(nextCursor);
      setTotalCommentCount(Number(page.total_count ?? mergedRoots.length));

      if (cache) {
        try {
          await cache.save(topicId, mergedRoots);
        } catch (cacheError) {
          console.error('Unable to update saved comments:', cacheError);
          setCacheWarning('Comments could not be saved for offline viewing.');
        }
      }
    } catch (error) {
      if (version === loadVersion.current) {
        console.error('Unable to load more comments:', error);
        setLoadMoreError('Unable to load more comments. Please try again.');
      }
    } finally {
      loadMoreInFlight.current = false;
      if (version === loadVersion.current) setLoadingMoreComments(false);
    }
  }, [
    nextCommentCursor,
    loadingMoreComments,
    isOnline,
    cachedAt,
    getClient,
    topicId,
    comments,
    currentProfile,
    sortComments,
    cache,
  ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadComments();
    return () => {
      // Invalidate every in-flight refresh, not just the first one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadVersion.current++;
    };
  }, [loadComments]);

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine);
    }

    function handleConnectivityChange() {
      updateOnlineStatus();
      if (cache) void loadComments();
    }

    updateOnlineStatus();
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);

    return () => {
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
    };
  }, [cache, loadComments]);

  async function createComment(content: string) {
    if (!navigator.onLine) {
      throw new Error('You need to be online to post comments.');
    }

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

    const supabase = getClient();

    const { data, error } = await supabase
      .from('comments')
      .insert({
        topic_id: topicId,
        user_id: userId,
        content,
        parent_id: null,
      })
      .select('id')
      .single();

    if (error || !data) {
      await loadComments();
      throw new Error(
        error?.code === 'P0001'
          ? 'You have reached the comment posting limit. Please try again later.'
          : 'Unable to post your comment. Please try again.'
      );
    }

    setComments((prev) => replaceCommentId(prev, tempId, data.id));
    setTotalCommentCount((previous) => (previous === null ? null : previous + 1));
    if (cache) await loadComments();
  }

  async function createReply(parentId: number, content: string) {
    if (!navigator.onLine) {
      throw new Error('You need to be online to post replies.');
    }

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

    const supabase = getClient();

    const { data, error } = await supabase
      .from('comments')
      .insert({
        topic_id: topicId,
        user_id: userId,
        parent_id: parentId,
        content,
      })
      .select('id')
      .single();

    if (error || !data) {
      await loadComments();
      throw new Error(
        error?.code === 'P0001'
          ? 'You have reached the comment posting limit. Please try again later.'
          : 'Unable to post your reply. Please try again.'
      );
    }

    setComments((prev) => replaceCommentId(prev, tempId, data.id));
    setTotalCommentCount((previous) => (previous === null ? null : previous + 1));
    if (cache) await loadComments();
  }

  async function editComment(commentId: number, content: string) {
    if (!navigator.onLine) {
      throw new Error('You need to be online to edit comments.');
    }

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

    const supabase = getClient();

    const { error } = await supabase
      .from('comments')
      .update({
        content,
        edited_at: editedAt,
      })
      .eq('id', commentId);

    if (error) {
      await loadComments();
      throw new Error(
        error.code === 'P0001'
          ? 'You have reached the comment edit limit. Please try again later.'
          : 'Unable to edit this comment. Your comment access may be restricted.'
      );
    }
    if (cache) await loadComments();
  }

  async function deleteComment(commentId: number) {
    if (!navigator.onLine) {
      setCommentActionError('You need an internet connection to delete comments.');
      return;
    }
    if (!window.confirm('Delete this comment?')) {
      return;
    }

    setCommentActionError('');
    setComments((prev) =>
      updateCommentTree(prev, commentId, (comment) => ({
        ...comment,
        is_deleted: true,
      }))
    );

    const supabase = getClient();

    const { error } = await supabase
      .from('comments')
      .update({
        is_deleted: true,
      })
      .eq('id', commentId);

    if (error) {
      console.error('Unable to delete comment:', error.message);
      await loadComments();
      setCommentActionError('Unable to delete this comment. Please try again.');
    } else if (cache) {
      await loadComments();
    }
  }

  async function togglePin(commentId: number) {
    if (!navigator.onLine) {
      setPinError('You need an internet connection to pin comments.');
      return;
    }
    if (!canPinComments) {
      return;
    }
    if (!serverActionsAvailable) {
      setPinError('Comment moderation is currently available on the website.');
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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cache) {
        const { data: sessionData, error: sessionError } = await getClient().auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session?.access_token) throw new Error('Sign in again to moderate comments.');
        headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      }
      const endpoint = cache
        ? new URL(`/api/admin/comments/${commentId}/pin`, siteConfig.url).toString()
        : `/api/admin/comments/${commentId}/pin`;
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pinned: shouldPin }),
      });

      if (!response.ok) {
        throw new Error(`Pin request failed with status ${response.status}`);
      }
      if (cache) await loadComments();
    } catch (error) {
      console.error('Unable to update pinned comment:', error);
      setPinError('Unable to update the pinned comment. Please try again.');
      await loadComments();
    } finally {
      setPinningCommentId(null);
    }
  }

  async function reportComment(commentId: number, reason: string, details: string) {
    if (!navigator.onLine) {
      throw new Error('You need an internet connection to submit a report.');
    }
    if (!serverActionsAvailable) {
      throw new Error('Comment reports are currently available on the website.');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cache) {
      const { data: sessionData, error: sessionError } = await getClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.access_token) throw new Error('Sign in again to submit a report.');
      headers.Authorization = `Bearer ${sessionData.session.access_token}`;
    }
    const endpoint = cache
      ? new URL('/api/reports/comments', siteConfig.url).toString()
      : '/api/reports/comments';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
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
    if (!navigator.onLine) {
      setCommentActionError('You need an internet connection to like comments.');
      return;
    }
    if (!userId) {
      requestSignIn('like comments');
      return;
    }

    const comment = findComment(comments, commentId);

    if (!comment) {
      return;
    }

    // Update the selected node and its like count optimistically; a failed
    // database mutation is reconciled by reloading the comment tree.
    setCommentActionError('');
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

    const supabase = getClient();

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
      console.error('Unable to update comment like:', error.message);
      await loadComments();
      setCommentActionError(
        error.code === 'P0001'
          ? 'You have reached the comment-like limit. Please try again later.'
          : 'Unable to update your like. Please try again.'
      );
    } else if (cache) {
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

      {cachedAt && (
        <p role="status" className="text-text-secondary mb-6 text-sm">
          {isOnline
            ? 'Comments could not be refreshed. Showing saved comments; they may have changed.'
            : "You're offline. Showing saved comments; they may have changed. Reconnect to refresh or participate."}
        </p>
      )}
      {cacheWarning && (
        <p role="alert" className="mb-6 text-sm text-red-600">
          {cacheWarning}
        </p>
      )}

      {cachedAt || !isOnline ? (
        <article className="border-border mb-6 rounded-2xl border p-6">
          <p className="text-text-secondary">
            You need an internet connection to join the discussion.
          </p>
        </article>
      ) : userId && (isCommentBanned || commentBanCheckFailed) ? (
        <>
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
          <div className="h-6" />
        </>
      ) : userId ? (
        <>
          <CommentForm
            onSubmit={createComment}
            disabled={!isOnline}
            disabledMessage="You need an internet connection to post comments."
          />

          <div className="h-6" />
        </>
      ) : (
        <>
          <article className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">Sign in to join the discussion.</p>
            <button
              type="button"
              onClick={() => requestSignIn('join the discussion')}
              className="text-accent mt-3 font-medium hover:underline"
            >
              Sign in
            </button>
          </article>

          <div className="h-6" />
        </>
      )}

      {pinError && (
        <p role="alert" className="mb-6 text-sm text-red-600">
          {pinError}
        </p>
      )}

      {commentActionError && (
        <p role="alert" className="mb-6 text-sm text-red-600">
          {commentActionError}
        </p>
      )}

      {commentLoadError ? (
        <article className="border-border rounded-2xl border p-6">
          <p role="alert" className="text-sm text-red-600">
            {commentLoadError}
          </p>
          <button
            type="button"
            onClick={() => void loadComments()}
            className="text-accent mt-3 text-sm font-medium hover:underline"
          >
            Try again
          </button>
        </article>
      ) : comments.length === 0 ? (
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
              canPin={canPinComments && serverActionsAvailable}
              canReport={serverActionsAvailable}
              profileLinksAvailable={serverActionsAvailable}
              isCommentBanned={isCommentBanned || commentBanCheckFailed}
              isOnline={isOnline && !cachedAt}
              hasPinnedComment={hasPinnedComment}
              isPinning={pinningCommentId === comment.id}
              pinActionPending={pinningCommentId !== null}
            />
          ))}
        </div>
      )}

      {hasMoreComments && isOnline && !cachedAt && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-text-secondary text-sm">
            Showing {loadedCommentCount} of {commentCount} comments
          </p>
          {loadMoreError && (
            <p role="alert" className="text-sm text-red-600">
              {loadMoreError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void loadMoreComments()}
            disabled={loadingMoreComments}
            className="border-border hover:bg-surface-secondary rounded-full border px-5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMoreComments ? 'Loading more comments…' : 'Load more comments'}
          </button>
        </div>
      )}
    </section>
  );
}
