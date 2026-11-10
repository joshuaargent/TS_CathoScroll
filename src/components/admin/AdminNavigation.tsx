import Link from 'next/link';

export function AdminNavigation() {
  return (
    <nav aria-label="Admin sections" className="mb-8 flex flex-wrap gap-3">
      <Link
        href="/admin"
        className="border-border hover:bg-bg-secondary rounded-lg border px-4 py-2 text-sm"
      >
        Dashboard
      </Link>
      <Link
        href="/admin/reports"
        className="border-border hover:bg-bg-secondary rounded-lg border px-4 py-2 text-sm"
      >
        All reports
      </Link>
      <Link
        href="/admin/appeals"
        className="border-border hover:bg-bg-secondary rounded-lg border px-4 py-2 text-sm"
      >
        Comment-ban appeals
      </Link>
      <Link
        href="/admin/content"
        className="border-border hover:bg-bg-secondary rounded-lg border px-4 py-2 text-sm"
      >
        Content library
      </Link>
    </nav>
  );
}
