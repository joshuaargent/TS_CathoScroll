import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { Topic } from '@/types';

export type PublicProfileData = {
  id: string;
  displayName: string;
  username: string;
  bio: string | null;
};

export type PublicProfileComment = {
  id: number | string;
  slug: string;
  question: string;
  content: string;
  created_at: string;
};

export function formatCompletedDate(dateString: string) {
  const completedDate = new Date(dateString);
  if (Number.isNaN(completedDate.getTime())) return 'Completed';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfCompleted = new Date(
    completedDate.getFullYear(),
    completedDate.getMonth(),
    completedDate.getDate()
  );
  const difference = Math.floor((startOfToday.getTime() - startOfCompleted.getTime()) / 86_400_000);
  if (difference === 0) return 'Completed today';
  if (difference === 1) return 'Completed yesterday';
  if (difference > 1 && difference < 7) return `Completed ${difference} days ago`;
  return 'Completed ' + completedDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Shared public-profile presentation. Web-only moderation controls are injected
 * by the website; native adapters provide the same public data without admin UI.
 */
export function PublicProfileView({
  profile,
  completedCount,
  bookmarkCount,
  commentCount,
  likesReceived,
  progressPercentage,
  currentStreak,
  longestStreak,
  recentTopics,
  recentComments,
  showAdminLink = false,
  moderationControls,
}: {
  profile: PublicProfileData;
  completedCount: number;
  bookmarkCount: number;
  commentCount: number;
  likesReceived: number;
  progressPercentage: string;
  currentStreak: number;
  longestStreak: number;
  recentTopics: Array<Topic & { completedAt: string }>;
  recentComments: PublicProfileComment[];
  showAdminLink?: boolean;
  moderationControls?: ReactNode;
}) {
  return (
    <div className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">{profile.displayName}</h1>
        <p className="text-text-secondary mt-4 text-lg">@{profile.username}</p>
        <p className="text-text-muted mt-4">
          {completedCount} Completed • {bookmarkCount} Bookmarks • {commentCount} Comments
        </p>
        <p className="text-text-secondary mt-6 max-w-3xl text-lg">{profile.bio || 'No bio yet.'}</p>
        {showAdminLink && (
          <a href="/admin" className="text-accent mt-5 inline-block font-medium hover:underline">
            Open moderation dashboard
          </a>
        )}
        {moderationControls}
        <div className="mt-6">
          <Badge variant="accent" size="lg">{progressPercentage}% Complete</Badge>
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
            <div className="bg-accent h-full rounded-full" style={{ width: `${Math.min(Number(progressPercentage), 100)}%` }} />
          </div>
        </article>
      </section>

      <section className="mb-16 grid gap-6 md:grid-cols-2 xl:grid-cols-6">
        {[
          ['Completed', completedCount],
          ['Bookmarked', bookmarkCount],
          ['Comments', commentCount],
          ['Likes Received', likesReceived],
          ['Streak', currentStreak],
          ['Best Streak', longestStreak],
        ].map(([label, value]) => (
          <article key={String(label)} className="border-border h-full rounded-2xl border p-6">
            <Badge variant="accent" size="sm">{label}</Badge>
            <p className="mt-4 text-5xl font-extrabold">{value}</p>
          </article>
        ))}
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
              <a key={comment.id} href={`/topic/${encodeURIComponent(comment.slug)}#comments`}>
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
              </a>
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
              <a key={topic.slug} href={`/topic/${encodeURIComponent(topic.slug)}`}>
                <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                  <Badge variant="accent" size="sm">{topic.category}</Badge>
                  <h3 className="mt-4 text-2xl font-bold">{topic.question}</h3>
                  <p className="text-text-secondary mt-4 text-sm">{formatCompletedDate(topic.completedAt)}</p>
                </article>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
