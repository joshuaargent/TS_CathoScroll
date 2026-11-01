'use client';

import { useEffect, useMemo, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { searchTopics } from '@/lib/search';

import { SearchInput } from './SearchInput';
import { SearchResults } from './SearchResults';

const suggestions = [
  'God',
  'Jesus',
  'Mary',
  'Prayer',
  'Grace',
  'Baptism',
  'The Church',
  'Confession',
  'Salvation',
  'Heaven',
];

export function SearchClient() {
  const searchParams = useSearchParams();

  const router = useRouter();

  const pathname = usePathname();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
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

  const results = useMemo(() => searchTopics(debouncedQuery), [debouncedQuery]);

  return (
    <div>
      <SearchInput value={query} onChange={setQuery} />

      {!query && (
        <section className="mt-8">
          <h2 className="text-text-muted mb-4 text-sm font-semibold tracking-wider uppercase">
            Popular Searches
          </h2>

          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setQuery(suggestion)}
                className="border-border hover:bg-bg-secondary rounded-full border px-4 py-2 text-sm transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      )}

      {debouncedQuery && (
        <div className="text-text-secondary mt-6 flex items-center justify-between text-sm">
          <span>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>

          <span>Searching for "{debouncedQuery}"</span>
        </div>
      )}

      <SearchResults query={debouncedQuery} results={results} />
    </div>
  );
}
