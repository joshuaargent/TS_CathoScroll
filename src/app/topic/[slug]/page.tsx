import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { TopicNotes } from '@/components/topic/TopicNotes';
import { TopicActions } from '@/components/topic/TopicActions';
import { TopicArticle, TopicArticleHeader } from '@/components/topic/TopicArticle';

import { CommentSection } from '@/components/comments/CommentSection';

import { getPublishedTopicBySlug, getPublishedTopicContext } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { Badge } from '@/components/ui/Badge';

interface Props {
  params: Promise<{
    slug: string;
  }>;
}

function getTopicDescription(explanation: string) {
  const normalized = explanation.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  const excerpt = normalized.slice(0, 157);
  const wordBoundary = excerpt.lastIndexOf(' ');

  return `${excerpt.slice(0, wordBoundary > 0 ? wordBoundary : excerpt.length).trimEnd()}...`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getPublishedTopicBySlug(slug);

  if (!topic) {
    return {
      title: 'Topic not found',
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const description = getTopicDescription(topic.explanation);
  const url = new URL(`/topic/${topic.slug}`, siteConfig.url).toString();

  return {
    title: topic.question,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'article',
      title: topic.question,
      description,
      url,
      siteName: siteConfig.name,
      images: [
        {
          url: siteConfig.ogImage,
          width: 512,
          height: 512,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: topic.question,
      description,
      images: [siteConfig.ogImage],
    },
  };
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  const context = await getPublishedTopicContext(slug);

  if (!context) {
    notFound();
  }

  const { topic, topicNumber, topicCount, previousTopic, nextTopic, relatedTopics } = context;

  return (
    <main className="container py-12">
      <TopicArticleHeader topic={topic} position={{ number: topicNumber, count: topicCount }} />

      <TopicActions topicId={String(topic.id)} slug={topic.slug} title={topic.question} />
      <TopicArticle topic={topic} />

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
