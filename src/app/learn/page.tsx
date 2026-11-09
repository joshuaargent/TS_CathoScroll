import { Badge } from '@/components/ui/Badge';
import type { Metadata } from 'next';
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
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Learn</h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Structured courses, audio lessons, and quizzes are coming soon.
        </p>
      </div>

      <div className="space-y-16">
        <section>
          <div className="border-border rounded-2xl border p-8">
            <Badge variant="accent" size="sm">
              Coming Soon
            </Badge>

            <h2 className="mt-4 text-3xl font-bold">A More Structured Way to Learn</h2>

            <p className="text-text-secondary mt-4 leading-relaxed">
              CathoScroll currently focuses on providing a growing library of Catholic topics that
              anyone can explore for free.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              We're currently focused on expanding that library and improving the core learning
              experience before introducing additional learning tools.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">What's Planned?</h2>

          <div className="grid gap-6 md:grid-cols-3">
            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Premium
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Audio Lessons</h3>

              <p className="text-text-secondary mt-3">
                Listen to narrated versions of topics and learn wherever you are.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Free - planned
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Learning Paths</h3>

              <p className="text-text-secondary mt-3">
                Follow structured courses designed to guide you through key areas of Catholic
                teaching step by step.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Free - planned
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Quizzes</h3>

              <p className="text-text-secondary mt-3">
                Reinforce your learning and test your understanding with interactive quizzes.
              </p>
            </article>
          </div>
        </section>

        <section>
          <div className="border-border rounded-2xl border p-8">
            <h2 className="text-3xl font-bold">In the Meantime</h2>

            <p className="text-text-secondary mt-4 leading-relaxed">
              You can already explore hundreds of Catholic topics, save bookmarks, track your
              progress, build streaks, and participate in community discussion across CathoScroll.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              New topics are being added regularly as the platform continues to grow.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
