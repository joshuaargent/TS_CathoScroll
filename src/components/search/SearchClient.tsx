'use client';

import { useEffect, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { TopicSearchResult } from '@/lib/search';
import { Skeleton } from '@/components/ui/Skeleton';

import { SearchInput } from './SearchInput';
import { SearchResults } from './SearchResults';
import { SearchSuggestions } from './SearchSuggestions';

export function SearchClient() {
  const searchParams = useSearchParams();

  const router = useRouter();

  const pathname = usePathname();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  const [debouncedQuery, setDebouncedQuery] = useState(query);

  const [results, setResults] = useState<TopicSearchResult[]>([]);

  const [searchError, setSearchError] = useState('');

  const [resultQuery, setResultQuery] = useState('');

  const searching = Boolean(debouncedQuery.trim()) && resultQuery !== debouncedQuery;

  useEffect(() => {
    // Wait briefly after typing before rerunning the local ranking algorithm.
    const timeout = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      return;
    }

    const controller = new AbortController();

    async function runSearch() {
      try {
        const response = await fetch(
          `/api/content/search?q=${encodeURIComponent(debouncedQuery)}`,
          { signal: controller.signal }
        );
        const result = (await response.json()) as {
          results?: TopicSearchResult[];
          error?: string;
        };
        if (!response.ok) {
          setSearchError(result.error ?? 'Search is temporarily unavailable.');
          setResults([]);
          setResultQuery(debouncedQuery);
          return;
        }
        setResults(result.results ?? []);
        setSearchError('');
        setResultQuery(debouncedQuery);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Unable to search topic catalog:', error);
        setSearchError('Search is temporarily unavailable. Please try again.');
        setResults([]);
        setResultQuery(debouncedQuery);
      }
    }

    void runSearch();
    return () => controller.abort();
  }, [debouncedQuery]);

  useEffect(() => {
    // Keep the address bar in sync with the immediate input so searches can
    // be bookmarked and restored on navigation.
    const params = new URLSearchParams(searchParams);

    if (query.trim()) {
      params.set('q', query);
    } else {
      params.delete('q');
    }

    router.replace(`${pathname}?${params.toString()}`, {
      scroll: false,
    });
  }, [query, pathname, router, searchParams]);

  return (
    <div>
      <SearchInput value={query} onChange={setQuery} />

      {!query && <SearchSuggestions onSelect={setQuery} />}

      {debouncedQuery && (
        <div className="text-text-secondary mt-6 flex items-center justify-between text-sm">
          <span>
            {searching
              ? 'Searching…'
              : `${results.length}${results.length === 30 ? '+' : ''} results`}
          </span>

          <span>Searching for "{debouncedQuery}"</span>
        </div>
      )}

      {resultQuery === debouncedQuery && searchError ? (
        <p role="alert" className="mt-6 text-sm text-red-600">
          {searchError}
        </p>
      ) : searching ? (
        <div role="status" aria-label="Loading search results" aria-busy="true" className="mt-6 grid gap-4">
          {Array.from({ length: 5 }, (_, index) => (
            <article key={index} className="border-border rounded-xl border p-5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-3 h-6 w-4/5" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </article>
          ))}
        </div>
      ) : (
        <SearchResults
          query={resultQuery === debouncedQuery ? debouncedQuery : ''}
          results={results}
        />
      )}
    </div>
  );
}
