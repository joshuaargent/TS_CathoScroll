import { createPageMetadata } from '@/lib/seo';
import { LearnContent } from '@/components/learn/LearnContent';

export const metadata = {
  ...createPageMetadata({
    title: "Learn",
    description: "Explore CathoScroll's growing library and learn about upcoming Catholic courses, audio lessons, and quizzes.",
    path: "/learn",
  }),
  robots: {
    index: false,
    follow: true,
  },
};

export default function LearnPage() {
  return (
    <main>
      <LearnContent />
    </main>
  );
}
