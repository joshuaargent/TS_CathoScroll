import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { OfflineCatalogue } from '@/lib/offline/catalogue';
import type { Topic } from '@/types';
import { createClient } from './supabase';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

type ProfileData = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
};

type RecentCompletion = { topic_id: string; completed_at: string };
type RecentComment = {
  id: string;
  topic_id: string;
  content: string;
  created_at: string;
  slug?: string;
  question?: string;
};

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function shiftDay(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function streaks(dates: string[]): { current: number; longest: number } {
  const days = [...new Set(dates.map(dayKey).filter(Boolean))].sort();
  if (!days.length) return { current: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index++) {
    if (days[index] === shiftDay(days[index - 1], 1)) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  const today = dayKey(new Date().toISOString());
  const yesterday = shiftDay(today, -1);
  let current = 0;
  let cursor = days.includes(today) ? today : days.includes(yesterday) ? yesterday : '';
  if (cursor) {
    const set = new Set(days);
    while (set.has(cursor)) {
      current++;
      cursor = shiftDay(cursor, -1);
    }
  }
  return { current, longest };
}

function completedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Completed';
  const today = new Date();
  const completed = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const difference = Math.round((start.getTime() - completed.getTime()) / 86_400_000);
  if (difference === 0) return 'Completed today';
  if (difference === 1) return 'Completed yesterday';
  if (difference > 1 && difference < 7) return `Completed ${difference} days ago`;
  return `Completed ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function NativePublicProfile({
  username,
  catalogue,
}: {
  username: string;
  catalogue: OfflineCatalogue;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [likesReceived, setLikesReceived] = useState(0);
  const [topicCount, setTopicCount] = useState(0);
  const [progressPercent, setProgressPercent] = useState('0');
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [recentTopics, setRecentTopics] = useState<Array<Topic & { completedAt: string }>>([]);
  const [recentComments, setRecentComments] = useState<RecentComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const noticeId = `public-profile:${username}`;
    async function load() {
      setLoading(true);
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
        const calculated = streaks(completionDates);
        const progressRowsRecent = (recentProgressResult.data ?? []) as RecentCompletion[];
        const comments = (commentsResult.data ?? []) as RecentComment[];
        const recentTopicIds = progressRowsRecent.map((entry) => String(entry.topic_id));
        const recentCommentTopicIds = comments.map((entry) => String(entry.topic_id));
        const [completionTopics, commentTopics] = await Promise.all([
          catalogue.topicsByIds(recentTopicIds),
          catalogue.topicsByIds(recentCommentTopicIds),
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
        setProfile(profileData);
        setCompletedCount(done);
        setBookmarkCount(bookmarkResult.count ?? 0);
        setCommentCount(commentCountResult.count ?? 0);
        setLikesReceived(received);
        setTopicCount(totalTopics);
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
            { id: noticeId, action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) } }
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [username, catalogue, attempt]);

  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">
        {loading && !profile ? (
          <p role="status">Loading public profile…</p>
        ) : profile ? (
          <>
            <h1 className="text-5xl font-extrabold md:text-7xl">{profile.display_name}</h1>
            <p className="text-text-secondary mt-4 text-lg">@{profile.username}</p>
            <p className="text-text-muted mt-4">
              {completedCount} Completed • {bookmarkCount} Bookmarks • {commentCount} Comments
            </p>
            <p className="text-text-secondary mt-6 max-w-3xl text-lg">{profile.bio || 'No bio yet.'}</p>
            <div className="mt-6">
              <Badge variant="accent" size="lg">{progressPercent}% Complete</Badge>
            </div>
          </>
        ) : (
          <h1 className="text-3xl font-bold">{loading ? 'Loading profile…' : 'Profile not found'}</h1>
        )}
      </div>
      {profile && (
        <>
          <section className="mb-16">
            <h2 className="mb-6 text-3xl font-bold">Progress</h2>
            <article className="border-border rounded-2xl border p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-bold">{completedCount} Topics Completed</h3>
                  <p className="text-text-secondary mt-2">{progressPercent}% of CathoScroll</p>
                </div>
                <div className="text-4xl font-extrabold">{progressPercent}%</div>
              </div>
              <div className="bg-bg-secondary mt-6 h-3 overflow-hidden rounded-full">
                <div className="bg-accent h-full rounded-full" style={{ width: `${Math.min(Number(progressPercent), 100)}%` }} />
              </div>
            </article>
          </section>
          <section className="mb-16">
            <h2 className="mb-6 text-3xl font-bold">Learning Statistics</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Current Streak', `${currentStreak} days`],
                ['Longest Streak', `${longestStreak} days`],
                ['Likes Received', String(likesReceived)],
                ['Topics Available', String(topicCount)],
              ].map(([label, value]) => (
                <article key={label} className="border-border rounded-2xl border p-5">
                  <p className="text-text-secondary text-sm">{label}</p>
                  <p className="mt-2 text-2xl font-bold">{value}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="mb-16">
            <h2 className="mb-6 text-3xl font-bold">Recent Activity</h2>
            {recentTopics.length ? (
              <div className="space-y-3">
                {recentTopics.map((topic) => (
                  <Link key={topic.id} href={`/topic/${encodeURIComponent(topic.slug)}`} className="border-border hover:bg-bg-secondary block rounded-xl border p-4">
                    <p className="font-semibold">{topic.question}</p>
                    <p className="text-text-secondary mt-1 text-sm">{completedLabel(topic.completedAt)}</p>
                  </Link>
                ))}
              </div>
            ) : <p className="text-text-secondary">No completed topics yet.</p>}
          </section>
          <section className="mb-16">
            <h2 className="mb-6 text-3xl font-bold">Recent Comments</h2>
            {recentComments.length ? (
              <div className="space-y-3">
                {recentComments.map((comment) => (
                  <Link key={comment.id} href={`/topic/${encodeURIComponent(comment.slug ?? '')}#comments`} className="border-border hover:bg-bg-secondary block rounded-xl border p-4">
                    <p className="text-text-secondary text-sm">{comment.question}</p>
                    <p className="mt-2 whitespace-pre-wrap">{comment.content}</p>
                    <p className="text-text-muted mt-2 text-xs">{new Date(comment.created_at).toLocaleDateString('en-GB')}</p>
                  </Link>
                ))}
              </div>
            ) : <p className="text-text-secondary">No comments yet.</p>}
          </section>
        </>
      )}
    </main>
  );
}
