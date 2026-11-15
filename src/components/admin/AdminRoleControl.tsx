'use client';

import { useState } from 'react';

interface AdminRoleControlProps {
  userId: string;
  isAdmin: boolean;
  canManage: boolean;
  fetcher?: typeof fetch;
  onChange?: () => void;
}

export function AdminRoleControl({
  userId,
  isAdmin,
  canManage,
  fetcher = fetch,
  onChange,
}: AdminRoleControlProps) {
  const [admin, setAdmin] = useState(isAdmin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canManage) return null;

  async function changeAdminRole(grant: boolean) {
    const action = grant ? 'Grant' : 'Revoke';
    const confirmed = window.confirm(
      grant
        ? 'Grant this account administrator access? They will be able to manage content and moderation.'
        : 'Revoke this account administrator access? They will immediately lose access to administrator tools.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      const response = await fetcher(`/api/admin/users/${userId}/role`, {
        method: grant ? 'POST' : 'DELETE',
      });
      const result = (await response.json()) as { error?: string; isAdmin?: boolean };
      if (!response.ok) {
        setError(result.error ?? `Unable to ${grant ? 'grant' : 'revoke'} administrator access.`);
        return;
      }

      setAdmin(Boolean(result.isAdmin));
      onChange?.();
    } catch (requestError) {
      console.error(`Unable to ${grant ? 'grant' : 'revoke'} administrator access:`, requestError);
      setError(`Unable to ${grant ? 'grant' : 'revoke'} administrator access. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border bg-bg-secondary/40 mt-6 rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-bold">Administrator access</h2>
          <p className="text-text-secondary mt-1 text-sm">
            {admin
              ? 'This account has access to content management and moderation tools.'
              : 'Grant this trusted user access to content management and moderation tools.'}
          </p>
        </div>
        {admin ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-accent/10 text-accent rounded-full px-3 py-1.5 text-sm font-semibold">
              Administrator
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => changeAdminRole(false)}
              className="border-border rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-bg-secondary disabled:opacity-50"
            >
              {busy ? 'Updating…' : 'Revoke access'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => changeAdminRole(true)}
            className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Updating…' : 'Make administrator'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
