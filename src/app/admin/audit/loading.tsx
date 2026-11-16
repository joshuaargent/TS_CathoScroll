import Link from 'next/link';
import { NativeGridSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <main className="container py-12">
      <div className="mt-8">
        <Link href="/admin" className="text-accent text-sm font-medium hover:underline">
          Back to admin dashboard
        </Link>
        <p className="text-accent mt-8 text-sm font-semibold tracking-wider uppercase">Owner security</p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Administrator audit log</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Append-only records of administrator moderation, role changes and security actions.
          Only the CathoScroll owner can view this log.
        </p>
      </div>
      <NativeGridSkeleton label="Loading administrator audit log" />
    </main>
  );
}
