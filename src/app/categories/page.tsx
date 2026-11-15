import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { getPublishedCategories, getPublishedTopicCount } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { Badge } from '@/components/ui/Badge';
import { CategoriesGrid } from '@/components/categories/CategoriesGrid';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

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

async function CategoriesContent() {
  const [categories, totalTopics] = await Promise.all([
    getPublishedCategories(),
    getPublishedTopicCount(),
  ]);

  return (
    <>
      <div className="mt-6">
        <Badge variant="accent" size="lg">
          {categories.length} Categories • {totalTopics} Topics
        </Badge>
      </div>
      <CategoriesGrid categories={categories} />
    </>
  );
}

function CategoriesContentSkeleton() {
  return (
    <div aria-label="Loading categories" aria-busy="true" role="status">
      <Skeleton className="mt-6 h-8 w-44" />
      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Categories</h1>
        <p className="text-text-secondary mt-4 text-lg">Browse the Catholic faith by topic.</p>
      </div>

      <Suspense fallback={<CategoriesContentSkeleton />}>
        <CategoriesContent />
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
