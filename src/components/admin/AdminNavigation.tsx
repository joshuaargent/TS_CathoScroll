export function AdminNavigation({ showContent = true }: { showContent?: boolean }) {
  return (
    <nav aria-label="Admin sections" className="mb-8 flex flex-wrap gap-3">
      <a
        href="/admin"
        className="border-border hover:bg-bg-secondary rounded-lg border px-4 py-2 text-sm"
      >
        Dashboard
      </a>
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
