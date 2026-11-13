import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SearchInput } from '@/components/search/SearchInput';
import { SearchResultCard } from '@/components/search/SearchResultCard';
import { Badge } from '@/components/ui/Badge';
import {
  OfflineCatalogue,
  type CatalogueCursor,
  type CategoryCursor,
} from '@/lib/offline/catalogue';
import type { ContentCategory, Topic } from '@/types';

export function CategoriesPage({ catalogue }: { catalogue: OfflineCatalogue }) {
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [totals, setTotals] = useState<{ categories: number; topics: number } | null>(null);
  const [cursor, setCursor] = useState<CategoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([catalogue.categories(), catalogue.totals()]).then(
      ([page, counts]) => {
        if (!active) return;
        setCategories(page.categories);
        setTotals(counts);
        setCursor(page.nextCursor);
        setLoading(false);
      },
      (cause: unknown) => {
        console.error('Unable to load offline categories:', cause);
        if (active) {
          setError('Unable to load categories. Please try again.');
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [catalogue, attempt]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await catalogue.categories(cursor);
      setCategories((previous) => [...previous, ...page.categories]);
      setCursor(page.nextCursor);
    } catch (cause) {
      console.error('Unable to load more offline categories:', cause);
      setError('Unable to load more categories. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Categories</h1>
        <p className="text-text-secondary mt-4 text-lg">Browse the Catholic faith by topic.</p>
        {totals && (
          <div className="mt-6">
            <Badge variant="accent" size="lg">
              {totals.categories} Categories • {totals.topics} Topics
            </Badge>
          </div>
        )}
      </div>
      {loading && !categories.length && <p role="status">Loading categories…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              if (cursor) {
                void loadMore();
              } else {
                setLoading(true);
                setError('');
                setAttempt((value) => value + 1);
              }
            }}
          >
            Retry
          </button>
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <Link key={category.slug} href={`/categories/${encodeURIComponent(category.slug)}`}>
            <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
              <Badge variant="accent" size="sm">
                Explore topics
              </Badge>
              <h2 className="mt-4 text-2xl font-bold">{category.name}</h2>
              <p className="text-text-secondary mt-3 leading-relaxed">{category.description}</p>
            </article>
          </Link>
        ))}
      </div>
      {cursor && !error && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="text-accent mt-8"
        >
          {loading ? 'Loading…' : 'Load more categories'}
        </button>
      )}
      {!loading && !error && !categories.length && <p>No categories available.</p>}
    </div>
  );
}

function TopicList({
  catalogue,
  category,
  search,
}: {
  catalogue: OfflineCatalogue;
  category?: string;
  search?: string;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cursor, setCursor] = useState<CatalogueCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    catalogue.topics({ category, search }).then(
      (page) => {
        if (!active) return;
        setTopics(page.topics);
        setCursor(page.nextCursor);
        setLoading(false);
      },
      (cause: unknown) => {
        console.error('Unable to load offline topics:', cause);
        if (active) {
          setError('Unable to load topics. Please try again.');
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [catalogue, category, search, attempt]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await catalogue.topics({ category, search, cursor });
      setTopics((previous) => [...previous, ...page.topics]);
      setCursor(page.nextCursor);
    } catch (cause) {
      console.error('Unable to load more offline topics:', cause);
      setError('Unable to load more topics. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {loading && !topics.length && (
        <p role="status" className="mt-8">
          Loading topics…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-8">
          {error}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              if (cursor) {
                void loadMore();
              } else {
                setLoading(true);
                setError('');
                setAttempt((value) => value + 1);
              }
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!loading && !error && !topics.length && (
        <p className="text-text-secondary mt-8">No matching topics found.</p>
      )}
      <div className={search ? 'mt-8 space-y-4' : 'grid gap-6 md:grid-cols-2'}>
        {topics.map((topic) =>
          search ? (
            <SearchResultCard key={topic.id} topic={topic} query={search} />
          ) : (
            <Link
              key={topic.id}
              href={`/topic/${encodeURIComponent(topic.slug)}`}
              className="border-border hover:bg-accent-light/10 block rounded-2xl border p-6 transition-colors"
            >
              <h2 className="text-xl leading-snug font-bold">{topic.question}</h2>
              <p className="text-text-secondary mt-4 leading-relaxed">{topic.answer}</p>
              <div className="text-accent mt-6 text-sm font-medium">Study Topic →</div>
            </Link>
          )
        )}
      </div>
      {cursor && !error && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="border-border hover:bg-bg-secondary mt-8 rounded-xl border px-5 py-3 text-sm font-medium"
        >
          {loading ? 'Loading…' : 'Load more topics'}
        </button>
      )}
    </>
  );
}

export function CategoryPage({ catalogue, slug }: { catalogue: OfflineCatalogue; slug: string }) {
  const [category, setCategory] = useState<ContentCategory | null>(null);
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([catalogue.category(slug), catalogue.categoryTopicCount(slug)]).then(
      ([result, count]) => {
        if (!active) return;
        setCategory(result);
        setTopicCount(count);
        setLoading(false);
      },
      (cause: unknown) => {
        console.error('Unable to load offline category:', cause);
        if (active) {
          setError('Unable to load this category. Please try again.');
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [catalogue, slug, attempt]);
  return (
    <div className="container py-12">
      <Link href="/categories" className="text-accent">
        ← Categories
      </Link>
      {loading && (
        <p role="status" className="mt-8">
          Loading category…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-8">
          {error}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              setError('');
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!loading && !error && !category && <p className="mt-8">Category not found.</p>}
      {category && (
        <>
          <section className="mt-8 mb-16">
            {topicCount !== null && (
              <Badge variant="accent" size="lg">
                {topicCount} {topicCount === 1 ? 'Topic' : 'Topics'}
              </Badge>
            )}
            <h1 className="mt-4 text-5xl leading-tight font-extrabold md:text-7xl">
              {category.name}
            </h1>
            <p className="text-text-secondary mt-6 max-w-3xl text-lg leading-relaxed">
              {category.description}
            </p>
          </section>
          <TopicList catalogue={catalogue} category={slug} />
        </>
      )}
    </div>
  );
}

export function SearchPage({
  catalogue,
  query,
  onQueryChange,
}: {
  catalogue: OfflineCatalogue;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const [debounced, setDebounced] = useState(query.trim().slice(0, 120));
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim().slice(0, 120)), 200);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <div className="container py-12">
      <section className="mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Search</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Search questions, answers, catechism references, and Scripture throughout CathoScroll.
        </p>
      </section>
      <SearchInput value={query} onChange={onQueryChange} />
      {query.trim() && debounced && (
        <TopicList key={debounced} catalogue={catalogue} search={debounced} />
      )}
    </div>
  );
}
