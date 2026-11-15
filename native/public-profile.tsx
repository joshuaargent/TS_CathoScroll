import { useCallback, useEffect, useState } from 'react';
import { PublicProfileView } from '@/components/profile/PublicProfileView';
import { CommentBanControl } from '@/components/admin/CommentBanControl';
import { AdminRoleControl } from '@/components/admin/AdminRoleControl';
import { calculateStreaks } from '@/lib/profile-metrics';
import type { Topic } from '@/types';
import { createClient } from './supabase';
import { siteConfig } from '@/lib/constants';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

type ProfileData = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
};

type RecentCompletion = { topic_id: string; completed_at: string };
type RecentComment = {
  id: number;
  topic_id: string;
  content: string;
  created_at: string;
  slug?: string;
  question?: string;
};

export function NativePublicProfile({
  username,
}: {
  username: string;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [likesReceived, setLikesReceived] = useState(0);
  const [progressPercent, setProgressPercent] = useState('0');
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [recentTopics, setRecentTopics] = useState<Array<Topic & { completedAt: string }>>([]);
  const [recentComments, setRecentComments] = useState<RecentComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [moderation, setModeration] = useState<{
    isAdmin: boolean;
    canManage: boolean;
    activeBan: { reason: string } | null;
    profileIsAdmin: boolean;
  } | null>(null);
  const adminFetcher = useCallback<typeof fetch>(async (input, init) => {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again to access moderation tools.');
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
    const client = createClient();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setModeration(null);
        setAttempt((value) => value + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    const noticeId = `public-profile:${username}`;
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    async function load() {
      try {
        if (!navigator.onLine) throw new Error('Connect to the internet to view this public profile.');
        const supabase = createClient();
        const { data: profileRow, error: profileError } = await supabase
          .from('profiles')
          .select('id,username,display_name,bio')
          .eq('username', username)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profileRow) {
          if (active) {
            setProfile(null);
            setLoading(false);
          }
          return;
        }
        const profileData = profileRow as ProfileData;
        let moderationData: {
          isAdmin: boolean;
          canManage: boolean;
          activeBan: { reason: string } | null;
          profileIsAdmin: boolean;
        } | null = null;
        try {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (sessionData.session?.access_token) {
            const moderationResponse = await adminFetcher(
              `/api/admin/users/${encodeURIComponent(profileData.id)}/role`
            );
            if (moderationResponse.ok) {
              moderationData = await moderationResponse.json();
              clearNativeStatusNotice(`profile-moderation:${username}`);
            } else if (moderationResponse.status === 403) {
              clearNativeStatusNotice(`profile-moderation:${username}`);
            } else {
              const result = (await moderationResponse.json()) as { error?: string };
              throw new Error(result.error ?? 'Unable to load profile moderation controls.');
            }
          }
        } catch (moderationError) {
          console.error('Unable to load native profile moderation controls:', moderationError);
          notifyNativeStatus('Profile moderation controls are temporarily unavailable.', {
            id: `profile-moderation:${username}`,
            action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
          });
        }
        const [
          progressResult,
          bookmarkResult,
          commentCountResult,
          recentProgressResult,
          commentsResult,
          topicCountResult,
        ] = await Promise.all([
          supabase.from('progress').select('topic_id,completed_at', { count: 'exact' }).eq('user_id', profileData.id),
          supabase.from('bookmarks').select('topic_id', { count: 'exact' }).eq('user_id', profileData.id),
          supabase.from('comments').select('id', { count: 'exact' }).eq('user_id', profileData.id).eq('is_deleted', false),
          supabase.from('progress').select('topic_id,completed_at').eq('user_id', profileData.id).order('completed_at', { ascending: false }).limit(6),
          supabase.from('comments').select('id,topic_id,content,created_at').eq('user_id', profileData.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(6),
          supabase.from('topics').select('id,category:categories!inner(is_published)', { count: 'exact', head: true }).eq('is_published', true).eq('category.is_published', true),
        ]);
        for (const result of [progressResult, bookmarkResult, commentCountResult, recentProgressResult, commentsResult, topicCountResult]) {
          if (result.error) throw result.error;
        }
        const progressRows = progressResult.data ?? [];
        const completionDates = progressRows.flatMap((row) => row.completed_at ? [row.completed_at] : []);
        const calculated = calculateStreaks(completionDates);
        const progressRowsRecent = (recentProgressResult.data ?? []) as RecentCompletion[];
        const comments = (commentsResult.data ?? []) as RecentComment[];
        const recentTopicIds = progressRowsRecent.map((entry) => String(entry.topic_id));
        const recentCommentTopicIds = comments.map((entry) => String(entry.topic_id));
        async function loadTopicsByIds(ids: string[]): Promise<Topic[]> {
          if (!ids.length) return [];
          const { data, error } = await supabase
            .from('topics')
            .select('id,slug,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(name,is_published)')
            .in('id', ids)
            .eq('is_published', true)
            .eq('category.is_published', true);
          if (error) throw error;
          return (data ?? []).map((row) => {
            const relation = Array.isArray(row.category) ? row.category[0] : row.category;
            return {
              id: row.id,
              slug: row.slug,
              category: relation?.name ?? '',
              question: row.question,
              answer: row.answer,
              explanation: row.explanation,
              catechism: { paragraphs: row.catechism_paragraphs ?? [], text: row.catechism_text },
              scripture: { reference: row.scripture_reference, text: row.scripture_text },
            } satisfies Topic;
          });
        }
        const [completionTopics, commentTopics] = await Promise.all([
          loadTopicsByIds(recentTopicIds),
          loadTopicsByIds(recentCommentTopicIds),
        ]);
        const completionById = new Map(completionTopics.map((topic) => [String(topic.id), topic]));
        const commentById = new Map(commentTopics.map((topic) => [String(topic.id), topic]));
        const mappedRecentTopics = progressRowsRecent.flatMap((entry) => {
          const topic = completionById.get(String(entry.topic_id));
          return topic && entry.completed_at ? [{ ...topic, completedAt: entry.completed_at }] : [];
        });
        const mappedRecentComments = comments.flatMap((comment) => {
          const topic = commentById.get(String(comment.topic_id));
          return topic ? [{ ...comment, slug: topic.slug, question: topic.question }] : [];
        });
        const commentIds = comments.map((comment) => comment.id);
        let received = 0;
        if (commentIds.length) {
          const { count, error: likesError } = await supabase
            .from('comment_likes')
            .select('comment_id', { count: 'exact', head: true })
            .in('comment_id', commentIds);
          if (likesError) throw likesError;
          received = count ?? 0;
        }
        if (!active) return;
        const totalTopics = topicCountResult.count ?? 0;
        const done = progressResult.count ?? 0;
        setModeration(moderationData);
        setProfile(profileData);
        setCompletedCount(done);
        setBookmarkCount(bookmarkResult.count ?? 0);
        setCommentCount(commentCountResult.count ?? 0);
        setLikesReceived(received);
        setProgressPercent(totalTopics > 0 ? ((done / totalTopics) * 100).toFixed(1) : '0');
        setCurrentStreak(calculated.current);
        setLongestStreak(calculated.longest);
        setRecentTopics(mappedRecentTopics);
        setRecentComments(mappedRecentComments);
        clearNativeStatusNotice(noticeId);
      } catch (cause) {
        console.error('Unable to load public profile:', cause);
        if (active) {
          notifyNativeStatus(
            cause instanceof Error && cause.message.startsWith('Connect to')
              ? cause.message
              : 'This public profile could not be loaded. Please try again.',
            { id: noticeId, action: { label: 'Retry', onClick: () => { setLoading(true); setAttempt((value) => value + 1); } } }
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, [username, attempt, adminFetcher]);

  if (!profile) {
    return (
      <div className="container py-12">
        <p className="text-text-secondary mt-8">
          {loading ? 'Loading public profile…' : 'Profile not found.'}
        </p>
      </div>
    );
  }

  return (
    <PublicProfileView
      profile={{
        id: profile.id,
        displayName: profile.display_name,
        username: profile.username,
        bio: profile.bio,
      }}
      completedCount={completedCount}
      bookmarkCount={bookmarkCount}
      commentCount={commentCount}
      likesReceived={likesReceived}
      progressPercentage={progressPercent}
      currentStreak={currentStreak}
      longestStreak={longestStreak}
      recentTopics={recentTopics}
      recentComments={recentComments.flatMap((comment) =>
        comment.slug && comment.question
          ? [{
              id: comment.id,
              slug: comment.slug,
              question: comment.question,
              content: comment.content,
              created_at: comment.created_at,
            }]
          : []
      )}
      showAdminLink={Boolean(moderation?.isAdmin)}
      moderationControls={
        moderation?.isAdmin && moderation.canManage ? (
          <>
            <CommentBanControl
              key={`comment-ban:${Boolean(moderation.activeBan)}:${moderation.activeBan?.reason ?? ''}`}
              userId={profile.id}
              activeBan={Boolean(moderation.activeBan)}
              reason={moderation.activeBan?.reason}
              canChangeBan
              fetcher={adminFetcher}
              onChange={() => setAttempt((value) => value + 1)}
            />
            <AdminRoleControl
              key={`admin-role:${moderation.profileIsAdmin}`}
              userId={profile.id}
              isAdmin={moderation.profileIsAdmin}
              canManage
              fetcher={adminFetcher}
              onChange={() => setAttempt((value) => value + 1)}
            />
          </>
        ) : null
      }
    />
  );
}
