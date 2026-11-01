import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export default function AboutPage() {
  return (
    <main className="container py-12">
      <div className="mt-12 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">About CathoScroll</h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Helping people learn, explore, and deepen their understanding of the Catholic faith
          through clear, engaging, and accessible educational content.
        </p>
      </div>

      <div className="space-y-16">
        <section>
          <h2 className="mb-6 text-3xl font-bold">Why CathoScroll Exists</h2>

          <div className="space-y-4">
            <p className="text-text-secondary leading-relaxed">
              Learning about Catholicism can often feel overwhelming. Valuable information is spread
              across books, websites, podcasts, videos, and academic resources, making it difficult
              to know where to begin.
            </p>

            <p className="text-text-secondary leading-relaxed">
              CathoScroll was created to provide a modern learning experience that makes Catholic
              teaching easier to discover, understand, and revisit.
            </p>

            <p className="text-text-secondary leading-relaxed">
              Whether you are exploring Catholicism for the first time, returning to the faith,
              preparing for RCIA, strengthening your knowledge, or simply curious about Church
              teaching, CathoScroll aims to make learning approachable and engaging.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">Our Mission</h2>

          <div className="border-border rounded-2xl border p-8">
            <p className="text-xl leading-relaxed font-medium">
              To help people encounter the richness of the Catholic faith through accessible,
              engaging, and trustworthy educational content.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">Our Approach</h2>

          <div className="space-y-4">
            <p className="text-text-secondary leading-relaxed">
              CathoScroll seeks to present Catholic teaching faithfully, clearly, and respectfully.
            </p>

            <p className="text-text-secondary leading-relaxed">
              The goal is not simply to provide information, but to help users understand the
              reasoning, history, Scripture, and theology behind Catholic beliefs and practices.
            </p>

            <p className="text-text-secondary leading-relaxed">
              While users are encouraged to discuss, ask questions, and engage with topics through
              comments and community features, opinions expressed by individual users do not
              necessarily represent the views of CathoScroll.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">How Content Is Created</h2>

          <div className="space-y-4">
            <p className="text-text-secondary leading-relaxed">
              Topics are researched and written with the aim of accurately presenting Catholic
              teaching in a way that is both accessible and engaging.
            </p>

            <p className="text-text-secondary leading-relaxed">
              Where appropriate, topics may draw upon Scripture, the Catechism of the Catholic
              Church, Church history, the writings of saints, theological sources, and other
              materials relevant to Catholic teaching.
            </p>

            <p className="text-text-secondary leading-relaxed">
              Content is regularly reviewed, refined, and expanded as CathoScroll develops and as
              new topics are added to the platform.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">What Makes CathoScroll Different?</h2>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Learn
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Topic Based Learning</h3>

              <p className="text-text-secondary mt-3">
                Explore Catholic theology, doctrine, Scripture, apologetics, prayer, Church history,
                morality, and more through focused, digestible topics.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Community
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Meaningful Discussion</h3>

              <p className="text-text-secondary mt-3">
                Learn alongside others through comments, replies, discussion, and shared exploration
                of important questions.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Progress
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Track Your Journey</h3>

              <p className="text-text-secondary mt-3">
                Save bookmarks, complete topics, build streaks, and create your own learning journey
                through the platform.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Premium
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Audio Lessons</h3>

              <p className="text-text-secondary mt-3">
                Listen to narrated versions of topics designed to make learning possible wherever
                you are.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Premium
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Learning Paths</h3>

              <p className="text-text-secondary mt-3">
                Follow structured learning journeys that guide you through key areas of Catholic
                teaching step by step.
              </p>
            </article>

            <article className="border-border rounded-2xl border p-6">
              <Badge variant="accent" size="sm">
                Premium
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">Quizzes</h3>

              <p className="text-text-secondary mt-3">
                Test your understanding, reinforce learning, and review important concepts through
                interactive quizzes.
              </p>
            </article>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">For Beginners and Lifelong Learners</h2>

          <div className="space-y-4">
            <p className="text-text-secondary leading-relaxed">
              CathoScroll is designed for people at every stage of their learning journey.
            </p>

            <p className="text-text-secondary leading-relaxed">
              Some users may be exploring Catholicism for the first time. Others may be lifelong
              Catholics seeking to deepen their understanding of theology, Scripture, history, and
              doctrine.
            </p>

            <p className="text-text-secondary leading-relaxed">
              Regardless of experience level, CathoScroll aims to make learning more approachable,
              structured, and enjoyable.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">Meet the Creator</h2>

          <div className="border-border rounded-2xl border p-8">
            <h3 className="text-2xl font-bold">Joshua Argent</h3>

            <p className="text-text-secondary mt-4 leading-relaxed">
              CathoScroll was created and is maintained by Joshua Argent, a student from England
              with a passion for technology, education, learning, and the Catholic faith.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              The project began with a simple idea: make Catholic learning feel less like searching
              through countless disconnected resources and more like using a modern educational
              platform built specifically for learning the faith.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              What started as an idea has grown into CathoScroll, a platform focused on helping
              people learn, discuss, and engage with Catholic teaching in a modern and accessible
              way.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">Looking Ahead</h2>

          <div className="space-y-4">
            <p className="text-text-secondary leading-relaxed">
              CathoScroll continues to grow through new topics, improved educational resources,
              community features, audio lessons, structured learning paths, and quizzes.
            </p>

            <p className="text-text-secondary leading-relaxed">
              While the platform evolves, the goal remains the same: to make learning about the
              Catholic faith accessible, engaging, and meaningful for people around the world.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">Get in Touch</h2>

          <p className="text-text-secondary leading-relaxed">
            Feedback, suggestions, questions, bug reports, and topic ideas are always welcome.
          </p>

          <div className="mt-6">
            <Link href="/contact">
              <Button
                size="lg"
                style={{
                  color: '#ffffff',
                }}
              >
                Contact Us
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
