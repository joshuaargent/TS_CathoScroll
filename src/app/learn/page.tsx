import type { Metadata } from 'next';
import { LearnContent } from '@/components/learn/LearnContent';
import { siteConfig } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Learn',
  description:
    "Explore CathoScroll's growing library and learn about upcoming Catholic courses, audio lessons, and quizzes.",
  alternates: {
    canonical: new URL('/learn', siteConfig.url).toString(),
  },
};

export default function LearnPage() {
  return (
    <main>
      <LearnContent />
    </main>
  );
}
