import Link from 'next/link';

import { topics } from '@/data/topics';
import { categories } from '@/data/categories';
import { Badge } from '@/components/ui/Badge';

export default function CategoriesPage() {
  const categoriesMetadata = categories.map(
    (category) => ({
      ...category,
      topicCount: topics.filter(
        (topic) =>
          topic.category ===
          category.name
      ).length,
    })
  );

  const totalTopics = topics.length;

  return (
    <main className="container py-12">
      <div className="mt-8 mb-16">

        <h1
          className="
            text-5xl
            font-extrabold
            md:text-7xl
          "
        >
          Categories
        </h1>

        <p
          className="
            mt-4
            text-lg
            text-text-secondary
          "
        >
          Browse the Catholic faith by topic.
        </p>

        <div className="mt-6">
          <Badge
            variant="accent"
            size="lg"
          >
            {categories.length} Categories •{' '}
            {totalTopics} Topics
          </Badge>
        </div>
      </div>

      <div
  className="
    grid
    gap-6
    md:grid-cols-2
    xl:grid-cols-3
  "
>
  {categoriesMetadata.map((category) => (
    <Link
      key={category.slug}
      href={`/categories/${category.slug}`}
    >
      <article
        className="
          h-full
          rounded-2xl
          border
          border-border
          p-6
          transition-colors
          hover:bg-bg-secondary
        "
      >
        <div className="flex items-center justify-between">
          <Badge
            variant="accent"
            size="sm"
          >
            {category.topicCount}{' '}
            {category.topicCount === 1
              ? 'Topic'
              : 'Topics'}
          </Badge>
        </div>

        <h2
          className="
            mt-4
            text-2xl
            font-bold
          "
        >
          {category.name}
        </h2>

        <p
          className="
            mt-3
            text-text-secondary
            leading-relaxed
          "
        >
          {category.description}
        </p>
      </article>
    </Link>
  ))}
</div>

      <section
        className="
          mt-16
          border-t
          border-border
          pt-8
          text-center
        "
      >
        <Link
          href="/"
          className="inline-flex items-center text-lg font-medium text-text-primary hover:text-text-secondary"
        >
          Explore the Feed →
        </Link>
      </section>
    </main>
  );
}