import { NativeCategorySkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <NativeCategorySkeleton label="Loading category" />
    </main>
  );
}
