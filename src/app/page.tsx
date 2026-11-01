import { TopicFeed } from '@/components/topic/TopicFeed';
import { topics } from '@/data/topics';
import { siteConfig } from '@/lib/constants';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Catholic Teaching',
  description: 'Explore clear, approachable guides to Catholic teaching, Scripture, prayer, and the Church.',
  alternates: {
    canonical: siteConfig.url,
  },
};

export default function HomePage() {
  return (
    <div
      className="
        h-[calc(100vh-4rem)]
        overflow-hidden
      "
    >
      <TopicFeed topics={topics} />
    </div>
  );
}