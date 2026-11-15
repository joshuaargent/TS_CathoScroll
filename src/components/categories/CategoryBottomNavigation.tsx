import Link from 'next/link';
import type { ContentCategory } from '@/types';

export function CategoryBottomNavigation({
  previousCategory,
  nextCategory,
}: {
  previousCategory: ContentCategory | null;
  nextCategory: ContentCategory | null;
}) {
  return (
    <section className="border-border mt-16 border-t pt-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          {previousCategory && (
            <Link
              href={`/categories/${encodeURIComponent(previousCategory.slug)}`}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              ← {previousCategory.name}
            </Link>
          )}
        </div>
        <Link href="/" className="text-accent hover:text-accent-hover font-medium">
          Explore Feed
        </Link>
        <div>
          {nextCategory && (
            <Link
              href={`/categories/${encodeURIComponent(nextCategory.slug)}`}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              {nextCategory.name} →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
