'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AdminRoleControlProps {
  userId: string;
  isAdmin: boolean;
  canManage: boolean;
}

export function AdminRoleControl({ userId, isAdmin, canManage }: AdminRoleControlProps) {
  const router = useRouter();
  const [admin, setAdmin] = useState(isAdmin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canManage) return null;

  async function grantAdminRole() {
    if (
      !window.confirm(
        'Grant this account administrator access? They will be able to manage content and moderation.'
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, { method: 'POST' });
      const result = (await response.json()) as { error?: string; isAdmin?: boolean };
      if (!response.ok) {
        setError(result.error ?? 'Unable to grant administrator access.');
        return;
      }

      setAdmin(Boolean(result.isAdmin));
      router.refresh();
    } catch (requestError) {
      console.error('Unable to grant administrator access:', requestError);
      setError('Unable to grant administrator access. Please try again.');
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
          <span className="bg-accent/10 text-accent rounded-full px-3 py-1.5 text-sm font-semibold">
            Administrator
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={grantAdminRole}
            className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Granting access…' : 'Make administrator'}
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
