import { SearchClient } from '@/components/search/SearchClient';

export default function SearchPage() {
  return (
    <main className="container py-12">
      <section className="mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">
          Search
        </h1>

        <p className="mt-4 max-w-2xl text-lg text-text-secondary">
          Search questions, answers,
          catechism references, and
          Scripture throughout
          CathoScroll.
        </p>
      </section>

      <SearchClient />
    </main>
  );
}