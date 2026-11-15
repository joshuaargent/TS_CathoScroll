import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { getPublishedCategories, getPublishedTopicCount } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { Badge } from '@/components/ui/Badge';
import { CategoriesGrid } from '@/components/categories/CategoriesGrid';
import { Skeleton } from '@/components/ui/Skeleton';

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

async function CategoriesCount({
  categoriesPromise,
  topicCountPromise,
}: {
  categoriesPromise: ReturnType<typeof getPublishedCategories>;
  topicCountPromise: ReturnType<typeof getPublishedTopicCount>;
}) {
  const [categories, totalTopics] = await Promise.all([categoriesPromise, topicCountPromise]);

  return (
    <div className="mt-6">
      <Badge variant="accent" size="lg">
        {categories.length} Categories • {totalTopics} Topics
      </Badge>
    </div>
  );
}

async function CategoriesGridContent({
  categoriesPromise,
}: {
  categoriesPromise: ReturnType<typeof getPublishedCategories>;
}) {
  const categories = await categoriesPromise;
  return <CategoriesGrid categories={categories} />;
}

function CategoriesCountSkeleton() {
  return <div className="mt-6"><Skeleton className="h-8 w-44" /></div>;
}

function CategoriesGridSkeleton() {
  return (
    <div
      aria-label="Loading categories"
      aria-busy="true"
      role="status"
      className="grid gap-6 md:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <article key={index} className="border-border rounded-2xl border p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-4 h-7 w-1/2" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
        </article>
      ))}
    </div>
  );
}

export default function CategoriesPage() {
  const categoriesPromise = getPublishedCategories();
  const topicCountPromise = getPublishedTopicCount();

  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Categories</h1>
        <p className="text-text-secondary mt-4 text-lg">Browse the Catholic faith by topic.</p>
        <Suspense fallback={<CategoriesCountSkeleton />}>
          <CategoriesCount
            categoriesPromise={categoriesPromise}
            topicCountPromise={topicCountPromise}
          />
        </Suspense>
      </div>

      <Suspense fallback={<CategoriesGridSkeleton />}>
        <CategoriesGridContent categoriesPromise={categoriesPromise} />
      </Suspense>

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
