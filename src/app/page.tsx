import { Suspense } from 'react';
import { TopicFeed } from '@/components/topic/TopicFeed';
import { Skeleton } from '@/components/ui/Skeleton';
import { getPublishedTopicPage } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { getRecommendationPage } from '@/lib/recommendations-server';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    absolute: 'Catholic Teaching | CathoScroll',
  },
  description:
    'Explore clear, approachable guides to Catholic teaching, Scripture, prayer, and the Church.',
  alternates: {
    canonical: siteConfig.url,
  },
  openGraph: {
    type: 'website',
    title: 'Catholic Teaching',
    description:
      'Explore clear, approachable guides to Catholic teaching, Scripture, prayer, and the Church.',
    url: siteConfig.url,
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
    title: 'Catholic Teaching',
    description:
      'Explore clear, approachable guides to Catholic teaching, Scripture, prayer, and the Church.',
    images: [siteConfig.ogImage],
  },
};

async function HomeFeed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { topics, nextCursor } = await getPublishedTopicPage({ limit: 50 });
    return (
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <TopicFeed topics={topics} nextCursor={nextCursor} userId={null} />
      </div>
    );
  }

  const { topics, nextCursor } = await getRecommendationPage(supabase);

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden">
      <TopicFeed topics={topics} nextCursor={nextCursor} userId={user.id} personalized />
    </div>
  );
}


function HomeFeedSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading topic feed"
      aria-busy="true"
      className="h-[calc(100vh-4rem)] overflow-hidden"
    >
      <div className="container flex h-full items-center justify-center py-8">
        <div className="border-border bg-bg-card w-full max-w-2xl rounded-2xl border p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-8 h-48 w-full" variant="rectangular" />
          <Skeleton className="mt-6 h-4 w-1/3" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFeedSkeleton />}>
      <HomeFeed />
    </Suspense>
  );
}
