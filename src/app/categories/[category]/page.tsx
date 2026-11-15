import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import {
  getPublishedCategories,
  getPublishedTopicCount,
  getPublishedTopicPage,
  type TopicPageCursor,
} from '@/lib/content';
import { siteConfig } from '@/lib/constants';

import { Badge } from '@/components/ui/Badge';
import { CategoryTopicGrid } from '@/components/categories/CategoryTopicGrid';
import { CategoryBottomNavigation } from '@/components/categories/CategoryBottomNavigation';

interface Props {
  params: Promise<{
    category: string;
  }>;
  searchParams: Promise<{
    afterOrder?: string;
    afterId?: string;
  }>;
}

const categoryPageSize = 50;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const categories = await getPublishedCategories();
  const categoryData = categories.find((item) => item.slug === category);

  if (!categoryData) {
    return {
      title: 'Category not found',
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const url = new URL(`/categories/${categoryData.slug}`, siteConfig.url).toString();

  return {
    title: categoryData.name,
    description: categoryData.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'website',
      title: categoryData.name,
      description: categoryData.description,
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
      title: categoryData.name,
      description: categoryData.description,
      images: [siteConfig.ogImage],
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ category }, { afterOrder, afterId }, categories] = await Promise.all([
    params,
    searchParams,
    getPublishedCategories(),
  ]);
  const categoryData = categories.find((item) => item.slug === category);

  if (!categoryData) {
    notFound();
  }

  const cursor: TopicPageCursor | undefined =
    afterOrder && afterId && /^\d+$/.test(afterOrder) && /^[a-zA-Z0-9-]+$/.test(afterId)
      ? { orderIndex: Number(afterOrder), id: afterId }
      : undefined;
  const [{ topics: categoryTopics, nextCursor }, topicCount] = await Promise.all([
    getPublishedTopicPage({ categorySlug: category, cursor, limit: categoryPageSize }),
    getPublishedTopicCount(category),
  ]);

  const categoryIndex = categories.findIndex((c) => c.slug === category);

  const previousCategory = categoryIndex > 0 ? categories[categoryIndex - 1] : null;

  const nextCategory = categoryIndex < categories.length - 1 ? categories[categoryIndex + 1] : null;

  return (
    <main className="container py-12">
      <section className="mt-8 mb-16">
        <Badge variant="accent" size="lg">
          {topicCount} {topicCount === 1 ? 'Topic' : 'Topics'}
        </Badge>

        <h1 className="mt-4 text-5xl leading-tight font-extrabold md:text-7xl">
          {categoryData.name}
        </h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-lg leading-relaxed">
          {categoryData.description}
        </p>
      </section>

      {nextCursor && (
        <div className="mt-8 flex justify-center">
          <Link
            href={`/categories/${category}?afterOrder=${nextCursor.orderIndex}&afterId=${encodeURIComponent(nextCursor.id)}`}
            className="border-border hover:bg-bg-secondary rounded-xl border px-5 py-3 text-sm font-medium"
          >
            Load more topics
          </Link>
        </div>
      )}

      {/* Topics */}

      <section>
        <CategoryTopicGrid topics={categoryTopics} />
      </section>

      <CategoryBottomNavigation
        previousCategory={previousCategory}
        nextCategory={nextCategory}
      />
    </main>
  );
}
