import Link from 'next/link';
import type { Topic } from '@/types';

export function CategoryTopicGrid({ topics }: { topics: Topic[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {topics.map((topic) => (
        <Link
          key={topic.id}
          href={`/topic/${encodeURIComponent(topic.slug)}`}
          className="border-border hover:bg-accent-light/10 block rounded-2xl border p-6 transition-colors"
        >
          <h2 className="text-xl leading-snug font-bold">{topic.question}</h2>
          <p className="text-text-secondary mt-4 leading-relaxed">{topic.answer}</p>
          <div className="text-accent mt-6 text-sm font-medium">Study Topic →</div>
        </Link>
      ))}
    </div>
  );
}
