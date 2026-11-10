import Link from 'next/link';
import type { Metadata } from 'next';

import { getPublishedCategories, getPublishedTopics } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = {
  title: 'Categories',
  description:
    'Browse Catholic teaching by topic, from Scripture and prayer to the sacraments and Church history.',
  alternates: {
    canonical: new URL('/categories', siteConfig.url).toString(),
  },
  openGraph: {
    type: 'website',
    title: 'Categories',
    description:
      'Browse Catholic teaching by topic, from Scripture and prayer to the sacraments and Church history.',
    url: new URL('/categories', siteConfig.url).toString(),
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
    title: 'Categories',
    description:
      'Browse Catholic teaching by topic, from Scripture and prayer to the sacraments and Church history.',
    images: [siteConfig.ogImage],
  },
};

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const [categories, topics] = await Promise.all([getPublishedCategories(), getPublishedTopics()]);
  const topicCounts = new Map<string, number>();

  for (const topic of topics) {
    topicCounts.set(topic.category, (topicCounts.get(topic.category) ?? 0) + 1);
  }

  const categoriesMetadata = categories.map((category) => ({
    ...category,
    topicCount: topicCounts.get(category.name) ?? 0,
  }));
  const totalTopics = topics.length;

  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Categories</h1>

        <p className="text-text-secondary mt-4 text-lg">Browse the Catholic faith by topic.</p>

        <div className="mt-6">
          <Badge variant="accent" size="lg">
            {categories.length} Categories • {totalTopics} Topics
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {categoriesMetadata.map((category) => (
          <Link key={category.slug} href={`/categories/${category.slug}`}>
            <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
              <div className="flex items-center justify-between">
                <Badge variant="accent" size="sm">
                  {category.topicCount} {category.topicCount === 1 ? 'Topic' : 'Topics'}
                </Badge>
              </div>

              <h2 className="mt-4 text-2xl font-bold">{category.name}</h2>

              <p className="text-text-secondary mt-3 leading-relaxed">{category.description}</p>
            </article>
          </Link>
        ))}
      </div>

      <section className="border-border mt-16 border-t pt-8 text-center">
        <Link
          href="/"
          className="text-text-primary hover:text-text-secondary inline-flex items-center text-lg font-medium"
        >
          Explore the Feed →
        </Link>
      </section>
    </main>
  );
}
