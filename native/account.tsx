import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { SigninForm } from '@/components/auth/SigninForm';
import { Button } from '@/components/ui/Button';
import { OfflineActivityStore } from '@/lib/offline/activity-store';
import { openNativeDatabases } from '@/lib/offline/native-database';
import { createClient } from './supabase';

export function NativeAccount({
  user,
  checking,
  available,
  onSignedIn,
}: {
  user: User | null;
  checking: boolean;
  available: boolean;
  onSignedIn: () => void;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function signOut() {
    if (!user || busy) return;
    if (!navigator.onLine) {
      setError('Connect to the internet before signing out.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const databases = await openNativeDatabases();
      const activity = new OfflineActivityStore(databases.activity);
      await activity.initialize();
      if ((await activity.pendingCount(user.id)) > 0) {
        setError('Your saved changes need to sync before you can sign out.');
        return;
      }
      const { error: signOutError } = await createClient().auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    } catch (cause) {
      console.error('Unable to sign out:', cause);
      setError('Unable to sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!available) {
    return (
      <p role="alert" className="container py-12">
        Sign-in is unavailable. Check your connection and restart the app if the problem continues.
        Your saved offline changes have not been removed.
      </p>
    );
  }
  if (checking) return <p className="container py-12">Loading account…</p>;
  if (!user) {
    return online ? (
      <SigninForm
        onSignedIn={onSignedIn}
        description="Sign in to use your account for online discussion. Bookmarks and progress are not yet available in this preview."
        allowSignup={false}
      />
    ) : (
      <p role="status" className="container py-12">
        Connect to the internet to sign in.
      </p>
    );
  }
  return (
    <div className="container py-12">
      <h1 className="mt-8 text-5xl font-extrabold">Account</h1>
      <p className="text-text-secondary mt-4">{user.email ?? 'Signed in'}</p>
      <p className="text-text-secondary mt-4">
        Bookmarks and progress are not yet available in this preview.
      </p>
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
      <Button className="mt-6" onClick={() => void signOut()} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}
