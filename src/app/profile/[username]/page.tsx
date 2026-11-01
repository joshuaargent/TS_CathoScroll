import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { Badge } from '@/components/ui/Badge';

import { topics } from '@/data/topics';

interface Props {
  params: Promise<{
    username: string;
  }>;
}

function calculateCurrentStreak(dates: string[]) {
  if (!dates.length) {
    return 0;
  }

  const uniqueDays = new Set(dates.map((date) => new Date(date).toISOString().split('T')[0]));

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const newest = new Date(dates[0]);

  newest.setHours(0, 0, 0, 0);

  const gap = Math.floor((today.getTime() - newest.getTime()) / (1000 * 60 * 60 * 24));

  if (gap > 1) {
    return 0;
  }

  let streak = 0;

  const cursor = new Date(newest);

  while (true) {
    const key = cursor.toISOString().split('T')[0];

    if (!uniqueDays.has(key)) {
      break;
    }

    streak++;

    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function calculateLongestStreak(dates: string[]) {
  if (!dates.length) {
    return 0;
  }

  const uniqueDays = [
    ...new Set(dates.map((date) => new Date(date).toISOString().split('T')[0])),
  ].sort();

  let longest = 1;

  let current = 1;

  for (let i = 1; i < uniqueDays.length; i++) {
    const previous = new Date(uniqueDays[i - 1]);

    const next = new Date(uniqueDays[i]);

    const diff = Math.floor((next.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));

    if (diff === 1) {
      current++;

      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}

function formatCompletedDate(dateString: string) {
  const completedDate = new Date(dateString);

  const today = new Date();

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const startOfCompleted = new Date(
    completedDate.getFullYear(),
    completedDate.getMonth(),
    completedDate.getDate()
  );

  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfCompleted.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) {
    return 'Completed today';
  }

  if (diffDays === 1) {
    return 'Completed yesterday';
  }

  if (diffDays < 7) {
    return `Completed ${diffDays} days ago`;
  }

  return `Completed ${completedDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (!profile) {
    notFound();
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

    supabase.from('progress').select('completed_at').eq('user_id', profile.id),

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

  const currentStreak = calculateCurrentStreak(streakDates);

  const longestStreak = calculateLongestStreak(streakDates);

  const progressPercentage =
    topics.length > 0 ? ((completedCount / topics.length) * 100).toFixed(1) : '0';

  const recentTopics = (recentProgressResult.data ?? [])
    .map((entry) => {
      const topic = topics.find((topic) => String(topic.id) === String(entry.topic_id));

      if (!topic) {
        return null;
      }

      return {
        ...topic,
        completedAt: entry.completed_at,
      };
    })
    .filter((topic): topic is NonNullable<typeof topic> => topic !== null);

  const recentComments = (commentsResult.data ?? [])
    .map((comment) => {
      const topic = topics.find((topic) => String(topic.id) === String(comment.topic_id));

      if (!topic) {
        return null;
      }

      return {
        ...comment,
        slug: topic.slug,
        question: topic.question,
      };
    })
    .filter((comment): comment is NonNullable<typeof comment> => comment !== null);

  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">{profile.display_name}</h1>

        <p className="text-text-secondary mt-4 text-lg">@{profile.username}</p>

        <p className="text-text-muted mt-4">
          {completedCount} Completed • {bookmarkCount} Bookmarks • {commentCount} Comments
        </p>

        <p className="text-text-secondary mt-6 max-w-3xl text-lg">{profile.bio || 'No bio yet.'}</p>

        <div className="mt-6">
          <Badge variant="accent" size="lg">
            {progressPercentage}% Complete
          </Badge>
        </div>
      </div>

      <section className="mb-16">
        <h2 className="mb-6 text-3xl font-bold">Progress</h2>

        <article className="border-border rounded-2xl border p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-bold">{completedCount} Topics Completed</h3>

              <p className="text-text-secondary mt-2">{progressPercentage}% of CathoScroll</p>
            </div>

            <div className="text-4xl font-extrabold">{progressPercentage}%</div>
          </div>

          <div className="bg-bg-secondary mt-6 h-3 overflow-hidden rounded-full">
            <div
              className="bg-accent h-full rounded-full"
              style={{
                width: `${progressPercentage}%`,
              }}
            />
          </div>
        </article>
      </section>

      <section className="3 mb-16 grid gap-6 md:grid-cols-2 xl:grid-cols-6">
        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Completed
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{completedCount}</p>
        </article>

        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Bookmarked
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{bookmarkCount}</p>
        </article>

        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Comments
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{commentCount}</p>
        </article>

        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Likes Received
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{likesReceived}</p>
        </article>

        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Streak
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{currentStreak}</p>
        </article>

        <article className="border-border h-full rounded-2xl border p-6">
          <Badge variant="accent" size="sm">
            Best Streak
          </Badge>

          <p className="mt-4 text-5xl font-extrabold">{longestStreak}</p>
        </article>
      </section>

      <section className="mb-16">
        <h2 className="mb-6 text-3xl font-bold">Recent Comments</h2>

        {recentComments.length === 0 ? (
          <article className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">No comments yet.</p>
          </article>
        ) : (
          <div className="grid gap-6">
            {recentComments.map((comment) => (
              <Link key={comment.id} href={`/topic/${comment.slug}#comments`}>
                <article className="border-border hover:bg-bg-secondary rounded-2xl border p-6 transition-colors">
                  <p className="font-semibold">{comment.question}</p>

                  <p className="text-text-secondary mt-3 line-clamp-3">{comment.content}</p>

                  <p className="text-text-muted mt-4 text-sm">
                    {new Date(comment.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-6 text-3xl font-bold">Recent Activity</h2>

        {recentTopics.length === 0 ? (
          <article className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">No completed topics yet.</p>
          </article>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {recentTopics.map((topic) => (
              <Link key={topic.slug} href={`/topic/${topic.slug}`}>
                <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                  <Badge variant="accent" size="sm">
                    {topic.category}
                  </Badge>

                  <h3 className="mt-4 text-2xl font-bold">{topic.question}</h3>

                  <p className="text-text-secondary mt-4 text-sm">
                    {formatCompletedDate(topic.completedAt)}
                  </p>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
