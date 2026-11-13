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

export function SearchSuggestions({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <section className="mt-8">
      <h2 className="text-text-muted mb-4 text-sm font-semibold tracking-wider uppercase">
        Popular Searches
      </h2>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="border-border hover:bg-bg-secondary rounded-full border px-4 py-2 text-sm transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
