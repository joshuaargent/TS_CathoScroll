import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { Badge } from '@/components/ui/Badge';

import { topics } from '@/data/topics';

function formatSavedDate(dateString: string) {
  const savedDate = new Date(dateString);

  const today = new Date();

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const startOfSaved = new Date(savedDate.getFullYear(), savedDate.getMonth(), savedDate.getDate());

  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfSaved.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) {
    return 'Saved today';
  }

  if (diffDays === 1) {
    return 'Saved yesterday';
  }

  if (diffDays < 7) {
    return `Saved ${diffDays} days ago`;
  }

  return `Saved ${savedDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

export default async function BookmarksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin');
  }

  const { data: bookmarks } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', {
      ascending: false,
    });

  const bookmarkedTopics =
    bookmarks?.flatMap((bookmark) => {
      const topic = topics.find((topic) => String(topic.id) === String(bookmark.topic_id));

      if (!topic) {
        return [];
      }

      return [
        {
          ...topic,
          bookmarkedAt: bookmark.created_at,
        },
      ];
    }) ?? [];

  return (
    <main className="container py-12">
      <div className="mt-8 mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Bookmarks</h1>

        <p className="text-text-secondary mt-4 text-lg">Topics you've saved for later.</p>

        <div className="mt-6">
          <Badge variant="accent" size="lg">
            {bookmarkedTopics.length} Bookmarked
            {bookmarkedTopics.length === 1 ? ' Topic' : ' Topics'}
          </Badge>
        </div>
      </div>

      {bookmarkedTopics.length === 0 ? (
        <section className="border-border rounded-2xl border p-12 text-center">
          <h2 className="text-3xl font-bold">No bookmarks yet</h2>

          <p className="text-text-secondary mx-auto mt-4 max-w-xl">
            Save topics while browsing the feed and they'll appear here for easy access later.
          </p>

          <Link
            href="/"
            className="text-text-primary hover:text-text-secondary mt-8 inline-flex text-lg font-medium"
          >
            Explore the Feed →
          </Link>
        </section>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {bookmarkedTopics.map((topic) => (
            <Link key={topic.id} href={`/topic/${topic.slug}`}>
              <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
                <Badge variant="accent" size="sm">
                  {topic.category}
                </Badge>

                <h2 className="mt-4 text-xl leading-tight font-bold">{topic.question}</h2>

                <p className="text-text-secondary mt-3 line-clamp-3">{topic.answer}</p>

                <p className="text-text-muted mt-6 text-sm">
                  {formatSavedDate(topic.bookmarkedAt)}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
