import { useCallback, useEffect, useState } from 'react';
import { PublicProfileView } from '@/components/profile/PublicProfileView';
import { CommentBanControl } from '@/components/admin/CommentBanControl';
import { AdminRoleControl } from '@/components/admin/AdminRoleControl';
import type { Topic } from '@/types';
import { createClient } from './supabase';
import { siteConfig } from '@/lib/constants';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';
import { NativeProfileSkeleton } from './skeletons';

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
    canManageBans: boolean;
    canManageRoles: boolean;
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
          canManageBans: boolean;
          canManageRoles: boolean;
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
        const [metricsResult, topicCountResult] = await Promise.all([
          supabase.rpc('get_public_profile_metrics', {
            p_profile_id: profileData.id,
            p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          supabase
            .from('topics')
            .select('id,category:categories!inner(is_published)', { count: 'exact', head: true })
            .eq('is_published', true)
            .eq('category.is_published', true),
        ]);
        if (metricsResult.error) throw metricsResult.error;
        if (topicCountResult.error) throw topicCountResult.error;

        const metrics = (metricsResult.data ?? {}) as {
          completed_count?: number;
          bookmark_count?: number;
          comment_count?: number;
          likes_received?: number;
          current_streak?: number;
          longest_streak?: number;
          recent_progress?: RecentCompletion[];
          recent_comments?: RecentComment[];
        };
        const progressRowsRecent = metrics.recent_progress ?? [];
        const comments = metrics.recent_comments ?? [];
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
        if (!active) return;
        const totalTopics = topicCountResult.count ?? 0;
        const done = Number(metrics.completed_count ?? 0);
        setModeration(moderationData);
        setProfile(profileData);
        setCompletedCount(done);
        setBookmarkCount(Number(metrics.bookmark_count ?? 0));
        setCommentCount(Number(metrics.comment_count ?? 0));
        setLikesReceived(Number(metrics.likes_received ?? 0));
        setProgressPercent(totalTopics > 0 ? ((done / totalTopics) * 100).toFixed(1) : '0');
        setCurrentStreak(Number(metrics.current_streak ?? 0));
        setLongestStreak(Number(metrics.longest_streak ?? 0));
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
        {loading ? <NativeProfileSkeleton /> : <p className="text-text-secondary">Profile not found.</p>}
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
        moderation?.isAdmin ? (
          <>
            <CommentBanControl
              key={`comment-ban:${Boolean(moderation.activeBan)}:${moderation.activeBan?.reason ?? ''}`}
              userId={profile.id}
              activeBan={Boolean(moderation.activeBan)}
              reason={moderation.activeBan?.reason}
              canChangeBan={moderation.canManageBans}
              fetcher={adminFetcher}
              onChange={() => setAttempt((value) => value + 1)}
            />
            {moderation.canManageRoles && <AdminRoleControl
              key={`admin-role:${moderation.profileIsAdmin}`}
              userId={profile.id}
              isAdmin={moderation.profileIsAdmin}
              canManage
              fetcher={adminFetcher}
              onChange={() => setAttempt((value) => value + 1)}
            />}
          </>
        ) : null
      }
    />
  );
}
