import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireAdminPage } from '@/lib/moderation/require-admin';
import { checkApiRateLimit } from '@/lib/security/api-rate-limit';

interface AuditEntry {
  id: number;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface PageProps {
  searchParams?: Promise<{ before?: string }>;
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  const { adminClient, user } = await requireAdminPage();
  const params = (await searchParams) ?? {};
  const beforeValue = params.before;
  const beforeId = beforeValue === undefined ? null : Number(beforeValue);

  if (
    beforeValue !== undefined &&
    (!/^[1-9]\d*$/.test(beforeValue) || !Number.isSafeInteger(beforeId))
  ) {
    notFound();
  }

  const { data: isOwner, error: ownerError } = await adminClient.rpc(
    'is_cathoscroll_admin_owner',
    { p_user_id: user.id }
  );
  if (ownerError) {
    console.error('Unable to verify audit-log owner access:', ownerError.message);
    throw new Error('Unable to verify audit-log access.');
  }
  if (isOwner !== true) notFound();

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:audit:read',
    identifier: user.id,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    throw new Error('Too many audit-log requests. Please wait before refreshing.');
  }

  const { data, error } = await adminClient.rpc('admin_get_action_audit', {
    p_actor_user_id: user.id,
    p_before_id: beforeId,
    p_limit: 50,
  });
  if (error) {
    console.error('Unable to load administrator audit log:', error.message);
    throw new Error('Unable to load audit log.');
  }

  const entries = (data ?? []) as AuditEntry[];
  const nextCursor = entries.length === 50 ? entries[entries.length - 1]?.id : null;

  return (
    <main className="container py-12">
      <div className="mt-8">
        <Link href="/admin" className="text-accent text-sm font-medium hover:underline">
          Back to admin dashboard
        </Link>
        <p className="text-accent mt-8 text-sm font-semibold tracking-wider uppercase">
          Owner security
        </p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Administrator audit log</h1>
        <p className="text-text-secondary mt-4 max-w-3xl">
          Append-only records of administrator moderation, role changes and security actions.
          Only the CathoScroll owner can view this log.
        </p>
      </div>

      <section className="mt-8 space-y-4">
        {entries.length === 0 ? (
          <p className="text-text-secondary border-border rounded-xl border p-5">
            No administrator actions have been recorded yet.
          </p>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className="border-border rounded-xl border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{entry.action}</h2>
                  <p className="text-text-secondary mt-1 text-sm">
                    {entry.target_type} · {entry.target_id}
                  </p>
                </div>
                <time className="text-text-muted text-sm" dateTime={entry.created_at}>
                  {new Date(entry.created_at).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}{' '}
                  UTC
                </time>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-text-muted">Administrator</dt>
                  <dd className="break-all">{entry.actor_user_id}</dd>
                </div>
                {entry.target_user_id && (
                  <div>
                    <dt className="text-text-muted">Target user</dt>
                    <dd className="break-all">{entry.target_user_id}</dd>
                  </div>
                )}
              </dl>
              {Object.keys(entry.details ?? {}).length > 0 && (
                <pre className="bg-bg-secondary mt-3 overflow-x-auto rounded-lg p-3 text-xs">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              )}
            </article>
          ))
        )}
      </section>

      {nextCursor !== null && (
        <div className="mt-8">
          <Link
            href={`/admin/audit?before=${nextCursor}`}
            className="border-border inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-bg-secondary"
          >
            Load older actions
          </Link>
        </div>
      )}
    </main>
  );
}
