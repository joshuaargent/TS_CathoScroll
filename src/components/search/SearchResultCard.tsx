import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';

import { Topic } from '@/types';

interface SearchResultCardProps {
  topic: Topic;
  query?: string;
}

function highlightText(text: string, query: string) {
  if (!query) {
    return text;
  }

  const regex = new RegExp(`(${query})`, 'gi');

  return text.split(regex).map((part, index) =>
    regex.test(part) ? (
      <mark key={index} className="bg-accent-light rounded px-1">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function SearchResultCard({ topic, query = '' }: SearchResultCardProps) {
  const preview = topic.answer.length > 180 ? `${topic.answer.slice(0, 180)}...` : topic.answer;

  const sources: string[] = [];

  const q = query.toLowerCase();

  if (q && topic.question.toLowerCase().includes(q)) {
    sources.push('Question');
  }

  if (q && topic.answer.toLowerCase().includes(q)) {
    sources.push('Answer');
  }

  if (q && topic.explanation.toLowerCase().includes(q)) {
    sources.push('Explanation');
  }

  if (q && topic.catechism.text.toLowerCase().includes(q)) {
    sources.push('Catechism');
  }

  if (q && topic.scripture.text.toLowerCase().includes(q)) {
    sources.push('Scripture');
  }

  return (
    <Link
      href={`/topic/${topic.slug}`}
      className="border-border bg-bg-card hover:bg-bg-secondary block rounded-2xl border p-6 transition-colors"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" size="sm">
          {topic.category}
        </Badge>

        {sources.map((source) => (
          <span
            key={source}
            className="border-border text-text-muted rounded-full border px-2 py-1 text-xs"
          >
            {source}
          </span>
        ))}
      </div>

      <h2 className="mt-4 text-xl leading-snug font-bold">
        {highlightText(topic.question, query)}
      </h2>

      <p className="text-text-secondary mt-3 leading-relaxed">{highlightText(preview, query)}</p>

      <div className="text-accent mt-4 text-sm font-medium">View Topic →</div>
    </Link>
  );
}
