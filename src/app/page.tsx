import { Suspense } from 'react';
import { TopicFeed } from '@/components/topic/TopicFeed';
import { getPublicGeneralTopicPage } from '@/lib/content';
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
    const { topics, nextCursor } = await getPublicGeneralTopicPage(null, 50);
    return (
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <TopicFeed topics={topics} nextCursor={nextCursor} userId={null} generalRanked />
      </div>
    );
  }

  const { data: personalizationStatus, error: personalizationStatusError } =
    await supabase.rpc('get_my_personalization_status');
  const personalizationEnabled =
    !personalizationStatusError &&
    typeof personalizationStatus === 'object' &&
    personalizationStatus !== null &&
    'enabled' in personalizationStatus &&
    personalizationStatus.enabled === true;

  if (!personalizationEnabled) {
    const { topics, nextCursor } = await getPublicGeneralTopicPage(null, 24);
    return (
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <TopicFeed
          topics={topics}
          nextCursor={nextCursor}
          userId={user.id}
          generalRanked
        />
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

function HomeFeedLoading() {
  return (
    <div
      className="h-[calc(100vh-4rem)] overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Loading your feed"
    >
      <div className="bg-bg-primary flex h-full w-full flex-col">
        <div className="shrink-0 px-6 pt-6 md:px-8 md:pt-8">
          <div className="bg-border h-1 w-full overflow-hidden rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 md:px-8 md:pb-8">
          <header className="flex items-center justify-between gap-3">
            <span className="text-text-muted text-xs tracking-wider uppercase">
              Your feed
            </span>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="mx-auto w-full max-w-3xl animate-pulse space-y-5">
              <div className="bg-bg-secondary mx-auto h-4 w-32 rounded" />
              <div className="bg-bg-secondary mx-auto h-12 w-4/5 rounded md:h-16" />
              <div className="bg-bg-secondary mx-auto h-12 w-3/5 rounded md:h-16" />
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your feed…</span>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFeedLoading />}>
      <HomeFeed />
    </Suspense>
  );
}
