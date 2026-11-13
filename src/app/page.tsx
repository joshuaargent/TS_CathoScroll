import { TopicFeed } from '@/components/topic/TopicFeed';
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

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { topics, nextCursor } = await getPublishedTopicPage({ limit: 50 });
    return (
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <TopicFeed topics={topics} nextCursor={nextCursor} />
      </div>
    );
  }

  const { topics, nextCursor } = await getRecommendationPage(supabase);

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden">
      <TopicFeed topics={topics} nextCursor={nextCursor} personalized />
    </div>
  );
}
