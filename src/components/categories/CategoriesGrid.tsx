import Link from 'next/link';
import type { ContentCategory } from '@/types';
import { Badge } from '@/components/ui/Badge';

export function CategoriesGrid({ categories }: { categories: ContentCategory[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {categories.map((category) => (
        <Link key={category.slug} href={`/categories/${encodeURIComponent(category.slug)}`}>
          <article className="border-border hover:bg-bg-secondary h-full rounded-2xl border p-6 transition-colors">
            <div className="flex items-center justify-between">
              <Badge variant="accent" size="sm">Explore topics</Badge>
            </div>
            <h2 className="mt-4 text-2xl font-bold">{category.name}</h2>
            <p className="text-text-secondary mt-3 leading-relaxed">{category.description}</p>
          </article>
        </Link>
      ))}
    </div>
  );
}
