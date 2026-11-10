import { SearchResultCard } from './SearchResultCard';
import type { TopicSearchResult } from '@/lib/search';

interface SearchResultsProps {
  query: string;
  results: TopicSearchResult[];
}

export function SearchResults({ query, results }: SearchResultsProps) {
  if (!query) {
    return null;
  }

  if (results.length === 0) {
    return (
      <section className="mt-8">
        <div className="border-border bg-bg-card rounded-2xl border p-8 text-center">
          <h2 className="text-xl font-semibold">No results found</h2>

          <p className="text-text-secondary mt-2">We couldn't find any matching topics.</p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['God', 'Prayer', 'Mary', 'Grace', 'Baptism', 'Salvation'].map((term) => (
              <span
                key={term}
                className="border-border text-text-secondary rounded-full border px-3 py-1 text-sm"
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="text-text-muted text-sm font-semibold tracking-wider uppercase">
          Search Results
        </h2>
      </div>

      <div className="space-y-4">
        {results.map((result) => (
          <SearchResultCard key={result.topic.slug} topic={result.topic} query={query} />
        ))}
      </div>
    </section>
  );
}
