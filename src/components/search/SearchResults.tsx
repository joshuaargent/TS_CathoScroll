import { SearchResultCard } from './SearchResultCard';

interface SearchResultsProps {
  query: string;
  results: {
    topic: any;
    score: number;
  }[];
}

export function SearchResults({
  query,
  results,
}: SearchResultsProps) {
  if (!query) {
    return null;
  }

  if (results.length === 0) {
    return (
      <section className="mt-8">
        <div
          className="
            rounded-2xl
            border
            border-border
            bg-bg-card
            p-8
            text-center
          "
        >
          <h2 className="text-xl font-semibold">
            No results found
          </h2>

          <p className="mt-2 text-text-secondary">
            We couldn't find any matching topics.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              'God',
              'Prayer',
              'Mary',
              'Grace',
              'Baptism',
              'Salvation',
            ].map((term) => (
              <span
                key={term}
                className="
                  rounded-full
                  border
                  border-border
                  px-3
                  py-1
                  text-sm
                  text-text-secondary
                "
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
        <h2
          className="
            text-sm
            font-semibold
            uppercase
            tracking-wider
            text-text-muted
          "
        >
          Search Results
        </h2>
      </div>

      <div className="space-y-4">
        {results.map((result) => (
          <SearchResultCard
            key={result.topic.slug}
            topic={result.topic}
            query={query}
          />
        ))}
      </div>
    </section>
  );
}