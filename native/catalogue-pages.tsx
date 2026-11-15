import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CategoriesGrid } from '@/components/categories/CategoriesGrid';
import { CategoryTopicGrid } from '@/components/categories/CategoryTopicGrid';
import { CategoryBottomNavigation } from '@/components/categories/CategoryBottomNavigation';
import { SearchInput } from '@/components/search/SearchInput';
import { SearchResults } from '@/components/search/SearchResults';
import { SearchSuggestions } from '@/components/search/SearchSuggestions';
import { Badge } from '@/components/ui/Badge';
import { topicSearchResultFromDatabase, type TopicSearchResult } from '@/lib/search';
import {
  OfflineCatalogue,
  type CatalogueCursor,
  type CategoryCursor,
} from '@/lib/offline/catalogue';
import type { ContentCategory, Topic } from '@/types';
import { createClient } from './supabase';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

type OnlineTopicRow = {
  id: string;
  slug: string;
  order_index: number;
  question: string;
  answer: string;
  explanation: string;
  catechism_paragraphs: string[] | null;
  catechism_text: string;
  scripture_reference: string;
  scripture_text: string;
  category: { name: string } | Array<{ name: string }> | null;
};

async function loadOnlineTopics(category?: string, cursor?: CatalogueCursor | null) {
  let query = createClient()
    .from('topics')
    .select('id,slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(name,slug,is_published)')
    .eq('is_published', true)
    .eq('category.is_published', true)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true })
    .limit(51);
  if (category) query = query.eq('category.slug', category);
  if (cursor) {
    query = query.or(
      'order_index.gt.' + cursor.orderIndex +
      ',and(order_index.eq.' + cursor.orderIndex + ',id.gt.' + cursor.id + ')'
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as OnlineTopicRow[];
  const hasMore = rows.length > 50;
  const pageRows = hasMore ? rows.slice(0, 50) : rows;
  const topics = pageRows.map((row) => {
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
  const last = pageRows.at(-1);
  return {
    topics,
    nextCursor: hasMore && last ? { orderIndex: last.order_index, id: last.id } : null,
  };
}


export function CategoriesPage({ catalogue }: { catalogue: OfflineCatalogue }) {
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [totals, setTotals] = useState<{ categories: number; topics: number } | null>(null);
  const [cursor, setCursor] = useState<CategoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    async function load() {
      try {
        if (navigator.onLine) {
          try {
            const client = createClient();
            const [categoryResult, topicResult] = await Promise.all([
              client.from('categories')
                .select('slug,name,description,order_index')
                .eq('is_published', true)
                .order('order_index', { ascending: true })
                .order('slug', { ascending: true }),
              client.from('topics')
                .select('id,category:categories!inner(is_published)', { count: 'exact', head: true })
                .eq('is_published', true)
                .eq('category.is_published', true),
            ]);
            if (categoryResult.error) throw categoryResult.error;
            if (topicResult.error) throw topicResult.error;
            if (!active) return;
            setCategories((categoryResult.data ?? []).map((category) => ({
              slug: category.slug,
              name: category.name,
              description: category.description,
              orderIndex: category.order_index,
            })));
            setTotals({ categories: categoryResult.data?.length ?? 0, topics: topicResult.count ?? 0 });
            setCursor(null);
            clearNativeStatusNotice('categories-fallback');
          } catch (onlineError) {
            console.error('Unable to load live categories:', onlineError);
            const [page, counts] = await Promise.all([catalogue.categories(), catalogue.totals()]);
            if (!active) return;
            setCategories(page.categories);
            setTotals(counts);
            setCursor(page.nextCursor);
            notifyNativeStatus('Live categories are unavailable. Showing saved categories.', {
              id: 'categories-fallback',
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        } else {
          const [page, counts] = await Promise.all([catalogue.categories(), catalogue.totals()]);
          if (!active) return;
          setCategories(page.categories);
          setTotals(counts);
          setCursor(page.nextCursor);
          clearNativeStatusNotice('categories-fallback');
        }
        clearNativeStatusNotice('categories-load');
        setError('');
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load categories:', cause);
        if (!active) return;
        setError('Unable to load categories. Please try again.');
        notifyNativeStatus('Unable to load categories. Please try again.', {
          id: 'categories-load',
          action: { label: 'Retry', onClick: () => { setError(''); setLoading(true); setAttempt((value) => value + 1); } },
        });
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
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
      notifyNativeStatus('Unable to load more categories. Please try again.', {
        id: 'categories-more',
        action: { label: 'Retry', onClick: () => void loadMore() },
      });
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

      <CategoriesGrid categories={categories} />
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
      <section className="border-border mt-16 border-t pt-8 text-center">
        <Link
          href="/"
          className="text-text-primary hover:text-text-secondary inline-flex items-center text-lg font-medium"
        >
          Explore the Feed →
        </Link>
      </section>
    </div>
  );
}

function TopicList({ catalogue, category }: { catalogue: OfflineCatalogue; category?: string }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cursor, setCursor] = useState<CatalogueCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    async function load() {
      try {
        let page: { topics: Topic[]; nextCursor: CatalogueCursor | null };
        if (navigator.onLine) {
          try {
            page = await loadOnlineTopics(category);
            clearNativeStatusNotice('category-topics-fallback:' + (category ?? 'all'));
          } catch (onlineError) {
            console.error('Unable to load live topics:', onlineError);
            page = await catalogue.topics({ category });
            notifyNativeStatus('Live topics are temporarily unavailable. Showing saved topics.', {
              id: 'category-topics-fallback:' + (category ?? 'all'),
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        } else {
          page = await catalogue.topics({ category });
        }
        if (!active) return;
        setTopics(page.topics);
        setCursor(page.nextCursor);
        setError('');
        clearNativeStatusNotice('category-topics:' + (category ?? 'all'));
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load topics:', cause);
        if (!active) return;
        setError('Unable to load topics. Please try again.');
        notifyNativeStatus('Unable to load topics. Please try again.', {
          id: 'category-topics:' + (category ?? 'all'),
          action: { label: 'Retry', onClick: () => { setError(''); setLoading(true); setAttempt((value) => value + 1); } },
        });
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, [catalogue, category, attempt]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      let page: { topics: Topic[]; nextCursor: CatalogueCursor | null };
      if (navigator.onLine) {
        try {
          page = await loadOnlineTopics(category, cursor);
          clearNativeStatusNotice('category-topics-fallback:' + (category ?? 'all'));
        } catch (onlineError) {
          console.error('Unable to load more live topics:', onlineError);
          page = await catalogue.topics({ category, cursor });
          notifyNativeStatus('Live topics are temporarily unavailable. Showing saved topics.', {
            id: 'category-topics-fallback:' + (category ?? 'all'),
            action: { label: 'Retry', onClick: () => void loadMore() },
          });
        }
      } else {
        page = await catalogue.topics({ category, cursor });
      }
      setTopics((previous) => [...previous, ...page.topics]);
      setCursor(page.nextCursor);
      clearNativeStatusNotice('category-topics-more:' + (category ?? 'all'));
    } catch (cause) {
      console.error('Unable to load more topics:', cause);
      setError('Unable to load more topics. Please try again.');
      notifyNativeStatus('Unable to load more topics. Please try again.', {
        id: 'category-topics-more:' + (category ?? 'all'),
        action: { label: 'Retry', onClick: () => void loadMore() },
      });
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

      {!loading && !error && !topics.length && (
        <p className="text-text-secondary mt-8">No matching topics found.</p>
      )}
      {cursor && !error && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="border-border hover:bg-bg-secondary rounded-xl border px-5 py-3 text-sm font-medium"
          >
            {loading ? 'Loading…' : 'Load more topics'}
          </button>
        </div>
      )}
      <CategoryTopicGrid topics={topics} />
    </>
  );
}

export function CategoryPage({ catalogue, slug }: { catalogue: OfflineCatalogue; slug: string }) {
  const [category, setCategory] = useState<ContentCategory | null>(null);
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [navigationCategories, setNavigationCategories] = useState<ContentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    async function load() {
      try {
        let result: ContentCategory | null;
        let count: number;
        if (navigator.onLine) {
          try {
            const client = createClient();
            const [categoryResult, countResult, navigationResult] = await Promise.all([
              client.from('categories')
                .select('slug,name,description,order_index')
                .eq('slug', slug)
                .eq('is_published', true)
                .maybeSingle(),
              client.from('topics')
                .select('id,category:categories!inner(slug,is_published)', { count: 'exact', head: true })
                .eq('is_published', true)
                .eq('category.is_published', true)
                .eq('category.slug', slug),
              client.from('categories')
                .select('slug,name,description,order_index')
                .eq('is_published', true)
                .order('order_index', { ascending: true })
                .order('slug', { ascending: true }),
            ]);
            if (categoryResult.error) throw categoryResult.error;
            if (countResult.error) throw countResult.error;
            if (navigationResult.error) throw navigationResult.error;
            if (!active) return;
            setNavigationCategories((navigationResult.data ?? []).map((item) => ({
              slug: item.slug,
              name: item.name,
              description: item.description,
              orderIndex: item.order_index,
            })));
            result = categoryResult.data ? {
              slug: categoryResult.data.slug,
              name: categoryResult.data.name,
              description: categoryResult.data.description,
              orderIndex: categoryResult.data.order_index,
            } : null;
            count = countResult.count ?? 0;
            clearNativeStatusNotice('category-page-fallback:' + slug);
          } catch (onlineError) {
            console.error('Unable to load live category:', onlineError);
            const [savedCategory, savedCount, savedCategories] = await Promise.all([
              catalogue.category(slug),
              catalogue.categoryTopicCount(slug),
              catalogue.categories(),
            ]);
            if (!active) return;
            result = savedCategory;
            count = savedCount;
            setNavigationCategories(savedCategories.categories);
            notifyNativeStatus('Live category details are unavailable. Showing saved information.', {
              id: 'category-page-fallback:' + slug,
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        } else {
          const [savedCategory, savedCount, savedCategories] = await Promise.all([
            catalogue.category(slug),
            catalogue.categoryTopicCount(slug),
            catalogue.categories(),
          ]);
          if (!active) return;
          result = savedCategory;
          count = savedCount;
          setNavigationCategories(savedCategories.categories);
        }
        if (!active) return;
        setCategory(result);
        setTopicCount(count);
        setError('');
        clearNativeStatusNotice('category-page:' + slug);
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load category:', cause);
        if (!active) return;
        setError('Unable to load this category. Please try again.');
        notifyNativeStatus('Unable to load this category. Please try again.', {
          id: 'category-page:' + slug,
          action: { label: 'Retry', onClick: () => { setError(''); setLoading(true); setAttempt((value) => value + 1); } },
        });
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, [catalogue, slug, attempt]);
  const categoryIndex = navigationCategories.findIndex((item) => item.slug === slug);
  const previousCategory = categoryIndex > 0 ? navigationCategories[categoryIndex - 1] : null;
  const nextCategory = categoryIndex >= 0 && categoryIndex < navigationCategories.length - 1
    ? navigationCategories[categoryIndex + 1]
    : null;

  return (
    <div className="container py-12">
      {loading && (
        <p role="status" className="mt-8">
          Loading category…
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
          <CategoryBottomNavigation
            previousCategory={previousCategory}
            nextCategory={nextCategory}
          />
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
  const [results, setResults] = useState<TopicSearchResult[]>([]);
  const [resultQuery, setResultQuery] = useState('');
  const [error, setError] = useState('');
  const [connectionVersion, setConnectionVersion] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim().slice(0, 120)), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const retry = () => setConnectionVersion((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, []);
  useEffect(() => {
    if (!debounced) {
      clearNativeStatusNotice('search-fallback');
      clearNativeStatusNotice('search-error');
      return;
    }
    let active = true;
    const controller = new AbortController();
    async function search() {
      if (navigator.onLine) {
        try {
          const { data, error: searchError } = await createClient()
            .rpc('search_published_topics', { search_query: debounced, result_limit: 30 })
            .abortSignal(controller.signal);
          if (searchError) throw searchError;
          if (!Array.isArray(data)) throw new Error('Invalid search response.');
          const onlineResults = data.map(topicSearchResultFromDatabase);
          if (!active) return;
          setResults(onlineResults);
          setResultQuery(debounced);
          setError('');
          clearNativeStatusNotice('search-fallback');
          clearNativeStatusNotice('search-error');
          return;
        } catch (cause) {
          if (!active || controller.signal.aborted) return;
          console.error('Unable to search online:', cause);
        }
      }
      try {
        const page = await catalogue.topics({ search: debounced });
        if (!active) return;
        setResults(page.topics.slice(0, 30).map((topic) => ({ topic, score: 0 })));
        setResultQuery(debounced);
        setError('');
        if (navigator.onLine) {
          notifyNativeStatus('Online search is unavailable. Showing results from saved topics.', { id: 'search-fallback' });
        } else {
          clearNativeStatusNotice('search-fallback');
        }
        clearNativeStatusNotice('search-error');
      } catch (cause) {
        console.error('Unable to search saved topics:', cause);
        if (!active) return;
        setResults([]);
        setResultQuery(debounced);
        setError('Search is temporarily unavailable. Please try again.');
        notifyNativeStatus('Search is temporarily unavailable. Please try again.', {
          id: 'search-error',
          action: { label: 'Retry', onClick: () => setConnectionVersion((value) => value + 1) },
        });
      }
    }
    void search();
    return () => {
      active = false;
      controller.abort();
    };
  }, [catalogue, debounced, connectionVersion]);
  const searching = Boolean(debounced) && resultQuery !== debounced;
  return (
    <div className="container py-12">
      <section className="mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Search</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Search questions, answers, catechism references, and Scripture throughout CathoScroll.
        </p>
      </section>
      <SearchInput value={query} onChange={onQueryChange} />
      {!query && <SearchSuggestions onSelect={onQueryChange} />}
      {debounced && (
        <div className="text-text-secondary mt-6 flex items-center justify-between text-sm">
          <span>
            {searching
              ? 'Searching…'
              : `${results.length}${results.length === 30 ? '+' : ''} results`}
          </span>
          <span>Searching for &quot;{debounced}&quot;</span>
        </div>
      )}
      {debounced && !error && <SearchResults query={resultQuery === debounced ? debounced : ''} results={results} />}
    </div>
  );
}
