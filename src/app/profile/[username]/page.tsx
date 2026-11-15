import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';
import { siteConfig } from '@/lib/constants';


import { getPublishedTopicCount, getPublishedTopicsByIds } from '@/lib/content';
import { CommentBanControl } from '@/components/admin/CommentBanControl';
import { AdminRoleControl } from '@/components/admin/AdminRoleControl';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { PublicProfileView } from '@/components/profile/PublicProfileView';
import { calculateStreaks } from '@/lib/profile-metrics';

interface Props {
  params: Promise<{
    username: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;

  return {
    title: `${username}'s Profile`,
    description: `View ${username}'s public learning profile on CathoScroll.`,
    alternates: {
      canonical: new URL(`/profile/${encodeURIComponent(username)}`, siteConfig.url).toString(),
    },
  };
}

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;

  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (!profile) {
    notFound();
  }

  const topicCount = await getPublishedTopicCount();

  let canManageCommentBan = false;
  let isAdmin = false;
  let profileIsAdmin = false;
  let activeBan: { reason: string } | null = null;

  if (currentUser) {
    const { data: adminRole, error: roleError } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (roleError) {
      console.error('Unable to verify profile moderation access:', roleError.message);
    } else if (adminRole) {
      isAdmin = true;

      if (currentUser.id !== profile.id) {
        canManageCommentBan = true;

        const serviceClient = createServiceRoleClient();
        const [banResult, profileAdminResult] = await Promise.all([
          serviceClient
            .from('user_comment_bans')
            .select('reason')
            .eq('user_id', profile.id)
            .is('unbanned_at', null)
            .maybeSingle(),
          serviceClient
            .from('admin_users')
            .select('user_id')
            .eq('user_id', profile.id)
            .maybeSingle(),
        ]);

        if (banResult.error) {
          console.error('Unable to load profile comment restriction:', banResult.error.message);
          throw new Error('Unable to load moderation details.');
        }
        if (profileAdminResult.error) {
          console.error(
            'Unable to load profile administrator status:',
            profileAdminResult.error.message
          );
          throw new Error('Unable to load administrator details.');
        }

        activeBan = banResult.data;
        profileIsAdmin = Boolean(profileAdminResult.data);
      }
    }
  }

  const [
    progressResult,
    bookmarksResult,
    recentProgressResult,
    streakResult,
    commentsResult,
    commentCountResult,
    commentLikesResult,
  ] = await Promise.all([
    supabase
      .from('progress')
      .select('topic_id', {
        count: 'exact',
      })
      .eq('user_id', profile.id),

    supabase
      .from('bookmarks')
      .select('topic_id', {
        count: 'exact',
      })
      .eq('user_id', profile.id),

    supabase
      .from('progress')
      .select('topic_id, completed_at')
      .eq('user_id', profile.id)
      .order('completed_at', {
        ascending: false,
      })
      .limit(6),

    supabase
      .from('progress')
      .select('completed_at')
      .eq('user_id', profile.id)
      .order('completed_at', { ascending: false }),

    supabase
      .from('comments')
      .select('id,topic_id,content,created_at,is_deleted')
      .eq('user_id', profile.id)
      .eq('is_deleted', false)
      .order('created_at', {
        ascending: false,
      })
      .limit(6),

    supabase
      .from('comments')
      .select('id', {
        count: 'exact',
      })
      .eq('user_id', profile.id)
      .eq('is_deleted', false),

    supabase.from('comment_likes').select('comment_id'),
  ]);

  const completedCount = progressResult.count ?? 0;

  const bookmarkCount = bookmarksResult.count ?? 0;

  const commentCount = commentCountResult.count ?? 0;

  const userCommentIds = (commentsResult.data ?? []).map((comment) => comment.id);

  const likesReceived = (commentLikesResult.data ?? []).filter((like) =>
    userCommentIds.includes(like.comment_id)
  ).length;

  const streakDates = (streakResult.data ?? []).map((row) => row.completed_at);

  const { current: currentStreak, longest: longestStreak } = calculateStreaks(streakDates);

  const progressPercentage =
    topicCount > 0 ? ((completedCount / topicCount) * 100).toFixed(1) : '0';

  const recentProgress = recentProgressResult.data ?? [];
  const recentTopicRows = await getPublishedTopicsByIds(
    recentProgress.map((entry) => String(entry.topic_id))
  );
  const recentTopicById = new Map(recentTopicRows.map((topic) => [topic.id, topic]));
  const recentTopics = recentProgress.flatMap((entry) => {
    const topic = recentTopicById.get(String(entry.topic_id));
    return topic ? [{ ...topic, completedAt: entry.completed_at }] : [];
  });

  const recentCommentRows = commentsResult.data ?? [];
  const recentCommentTopics = await getPublishedTopicsByIds(
    recentCommentRows.map((comment) => String(comment.topic_id))
  );
  const recentCommentTopicById = new Map(recentCommentTopics.map((topic) => [topic.id, topic]));
  const recentComments = recentCommentRows.flatMap((comment) => {
    const topic = recentCommentTopicById.get(String(comment.topic_id));
    return topic ? [{ ...comment, slug: topic.slug, question: topic.question }] : [];
  });

  return (
    <main>
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
      progressPercentage={progressPercentage}
      currentStreak={currentStreak}
      longestStreak={longestStreak}
      recentTopics={recentTopics}
      recentComments={recentComments}
      showAdminLink={isAdmin}
      moderationControls={
        <>
          <CommentBanControl
            userId={profile.id}
            activeBan={Boolean(activeBan)}
            reason={activeBan?.reason}
            canChangeBan={canManageCommentBan}
          />
          <AdminRoleControl
            userId={profile.id}
            isAdmin={profileIsAdmin}
            canManage={isAdmin && currentUser?.id !== profile.id}
          />
        </>
      }
    />
    </main>
  );
}
