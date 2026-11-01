
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { topics } from '@/data/topics';
import { categories } from '@/data/categories';

import { Badge } from '@/components/ui/Badge';

interface Props {
  params: Promise<{
    category: string;
  }>;
}

export default async function CategoryPage({
  params,
}: Props) {
  const { category } = await params;

  const categoryData = categories.find(
    (c) => c.slug === category
  );

  if (!categoryData) {
    notFound();
  }

  const categoryTopics = topics.filter(
    (topic) =>
      topic.category === categoryData.name
  );

  const categoryIndex = categories.findIndex(
    (c) => c.slug === category
  );

  const previousCategory =
    categoryIndex > 0
      ? categories[categoryIndex - 1]
      : null;

  const nextCategory =
    categoryIndex < categories.length - 1
      ? categories[categoryIndex + 1]
      : null;

  return (
    <main className="container py-12">

      <section className="mt-8 mb-16">

        <Badge
          variant="accent"
          size="lg"
        >
          {categoryTopics.length}{' '}
          {categoryTopics.length === 1
            ? 'Topic'
            : 'Topics'}
        </Badge>

        <h1
          className="
            mt-4
            text-5xl
            font-extrabold
            leading-tight
            md:text-7xl
          "
        >
          {categoryData.name}
        </h1>

        <p
          className="
            mt-6
            max-w-3xl
            text-lg
            text-text-secondary
            leading-relaxed
          "
        >
          {categoryData.description}
        </p>

      </section>

      {/* Topics */}

      <section>

        <div className="grid gap-6 md:grid-cols-2">

          {categoryTopics.map((topic) => (

            <Link
              key={topic.id}
              href={`/topic/${topic.slug}`}
              className="
                block
                rounded-2xl
                border
                border-border
                p-6
                transition-colors
                hover:bg-accent-light/10
              "
            >

              <h2
                className="
                  text-xl
                  font-bold
                  leading-snug
                "
              >
                {topic.question}
              </h2>

              <p
                className="
                  mt-4
                  text-text-secondary
                  leading-relaxed
                "
              >
                {topic.answer}
              </p>

              <div
                className="
                  mt-6
                  text-sm
                  font-medium
                  text-accent
                "
              >
                Study Topic →
              </div>

            </Link>

          ))}

        </div>

      </section>

      {/* Bottom Navigation */}

      <section
        className="
          mt-16
          border-t
          border-border
          pt-8
        "
      >

        <div
          className="
            flex
            flex-col
            gap-4
            md:flex-row
            md:items-center
            md:justify-between
          "
        >

          <div>
            {previousCategory && (

              <Link
                href={`/categories/${previousCategory.slug}`}
                className="
                  text-text-secondary
                  hover:text-text-primary
                  transition-colors
                "
              >
                ← {previousCategory.name}
              </Link>

            )}
          </div>

          <Link
            href="/"
            className="
              font-medium
              text-accent
              hover:text-accent-hover
            "
          >
            Explore Feed
          </Link>

          <div>
            {nextCategory && (

              <Link
                href={`/categories/${nextCategory.slug}`}
                className="
                  text-text-secondary
                  hover:text-text-primary
                  transition-colors
                "
              >
                {nextCategory.name} →
              </Link>

            )}
          </div>

        </div>

      </section>

    </main>
  );
}
