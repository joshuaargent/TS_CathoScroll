import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TopicNotes } from '@/components/topic/TopicNotes';
import { TopicActions } from '@/components/topic/TopicActions';

import { CommentSection } from '@/components/comments/CommentSection';

import { topics } from '@/data/topics';
import { Badge } from '@/components/ui/Badge';

interface Props {
  params: Promise<{
    slug: string;
  }>;
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;

  const topicIndex = topics.findIndex((t) => t.slug === slug);

  if (topicIndex === -1) {
    notFound();
  }

  const topic = topics[topicIndex];

  const previousTopic = topicIndex > 0 ? topics[topicIndex - 1] : null;

  const nextTopic = topicIndex < topics.length - 1 ? topics[topicIndex + 1] : null;

  const relatedTopics = topics
    .filter((t) => t.category === topic.category && t.slug !== topic.slug)
    .slice(0, 4);

  return (
    <main className="container py-12">
      <section className="mt-8 mb-16">
        <Badge variant="accent" size="lg">
          {topic.category}
        </Badge>

        <div className="text-text-muted mt-4 text-sm tracking-wider uppercase">
          Topic {topicIndex + 1} of {topics.length}
        </div>

        <h1 className="mt-4 text-5xl leading-tight font-extrabold md:text-7xl">{topic.question}</h1>

        <p className="mt-8 max-w-4xl text-2xl leading-relaxed font-semibold md:text-3xl">
          {topic.answer}
        </p>
      </section>

      <TopicActions topicId={String(topic.id)} slug={topic.slug} title={topic.question} />

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

      <TopicNotes topicId={String(topic.id)} />

      <CommentSection topicId={String(topic.id)} />

      {relatedTopics.length > 0 && (
        <section className="mb-16">
          <h2 className="mb-6 text-3xl font-bold">Related Topics</h2>

          <div className="grid gap-4 md:grid-cols-2">
            {relatedTopics.map((related) => (
              <Link
                key={related.slug}
                href={`/topic/${related.slug}`}
                className="border-border hover:bg-accent-light/10 block rounded-xl border p-6 transition-colors"
              >
                <h3 className="text-xl font-bold">{related.question}</h3>

                <div className="mt-3">
                  <Badge variant="accent" size="sm">
                    {related.category}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="border-border border-t pt-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            {previousTopic && (
              <Link
                href={`/topic/${previousTopic.slug}`}
                className="text-text-secondary hover:text-text-primary"
              >
                ← Previous Topic
              </Link>
            )}
          </div>

          <Link href="/" className="text-text-secondary hover:text-text-primary">
            Explore Feed
          </Link>

          <div>
            {nextTopic && (
              <Link
                href={`/topic/${nextTopic.slug}`}
                className="text-text-secondary hover:text-text-primary"
              >
                Next Topic →
              </Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
