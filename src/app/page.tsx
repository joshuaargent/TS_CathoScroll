import { TopicFeed } from '@/components/topic/TopicFeed';
import { getPublishedTopicPage } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { recommendTopics } from '@/lib/recommendations';
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
  const [{ topics, nextCursor }, supabase] = await Promise.all([
    getPublishedTopicPage({ limit: 50 }),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <TopicFeed topics={topics} nextCursor={nextCursor} />
      </div>
    );
  }

  const { data: engagementRows, error: engagementError } =
    await supabase.rpc('get_my_topic_engagement');
  if (engagementError) {
    throw new Error(`Unable to personalize your topic feed: ${engagementError.message}`);
  }

  const engagement = (engagementRows?.[0] ?? {}) as {
    progress_topic_ids?: string[];
    bookmark_topic_ids?: string[];
    liked_topic_ids?: string[];
    commented_topic_ids?: string[];
  };
  const recommendedTopics = recommendTopics(topics, {
    completedTopicIds: engagement.progress_topic_ids ?? [],
    bookmarkedTopicIds: engagement.bookmark_topic_ids ?? [],
    likedTopicIds: engagement.liked_topic_ids ?? [],
    commentedTopicIds: engagement.commented_topic_ids ?? [],
  });

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden">
      <TopicFeed topics={recommendedTopics} nextCursor={nextCursor} personalized />
    </div>
  );
}
