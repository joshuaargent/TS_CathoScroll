import { SearchClient } from '@/components/search/SearchClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search Catholic topics, answers, Catechism references, and Scripture.',
  robots: {
    index: false,
    follow: true,
  },
};

export const dynamic = 'force-dynamic';

export default function SearchPage() {
  return (
    <main className="container py-12">
      <section className="mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Search</h1>

        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Search questions, answers, catechism references, and Scripture throughout CathoScroll.
        </p>
      </section>

      <SearchClient />
    </main>
  );
}
