import { NativeGridSkeleton } from '../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <section className="mb-12">
        <h1 className="text-5xl font-extrabold md:text-7xl">Search</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Search questions, answers, catechism references, and Scripture throughout CathoScroll.
        </p>
      </section>
      <NativeGridSkeleton label="Loading search results" />
    </main>
  );
}
