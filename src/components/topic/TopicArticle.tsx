import { Badge } from '@/components/ui/Badge';
import type { Topic } from '@/types';

export function TopicArticleHeader({
  topic,
  position,
}: {
  topic: Topic;
  position?: { number: number; count: number };
}) {
  return (
    <section className="mt-8 mb-16">
      <Badge variant="accent" size="lg">
        {topic.category}
      </Badge>
      {position && (
        <div className="text-text-muted mt-4 text-sm tracking-wider uppercase">
          Topic {position.number} of {position.count}
        </div>
      )}
      <h1 className="mt-4 text-5xl leading-tight font-extrabold md:text-7xl">{topic.question}</h1>
      <p className="mt-8 max-w-4xl text-2xl leading-relaxed font-semibold md:text-3xl">
        {topic.answer}
      </p>
    </section>
  );
}

export function TopicArticle({ topic }: { topic: Topic }) {
  return (
    <>
      <section className="mt-8 mb-16">
        <h2 className="mb-6 text-3xl font-bold">Explanation</h2>
        <p className="max-w-4xl text-lg leading-relaxed">{topic.explanation}</p>
      </section>
      <section className="border-border bg-accent-light/10 mb-16 rounded-2xl border p-8">
        <h2 className="mb-6 text-3xl font-bold">Catechism</h2>
        <p className="text-lg leading-relaxed">{topic.catechism.text}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {topic.catechism.paragraphs.map((paragraph) => (
            <span key={paragraph} className="border-border rounded-full border px-3 py-1 text-sm">
              CCC {paragraph}
            </span>
          ))}
        </div>
      </section>
      <section className="border-border mb-16 rounded-2xl border p-8">
        <h2 className="mb-3 text-3xl font-bold">Scripture</h2>
        <p className="text-text-secondary mb-6 text-sm">{topic.scripture.reference}</p>
        <blockquote className="border-accent border-l-4 pl-6 text-xl italic">
          {topic.scripture.text}
        </blockquote>
      </section>
    </>
  );
}
