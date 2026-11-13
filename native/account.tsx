import { useEffect, useState } from 'react';
import type { CachedIdentity } from './cached-identity';
import { SigninForm } from '@/components/auth/SigninForm';
import { Button } from '@/components/ui/Button';
import type { NativeActivity, NativeActivityStatus } from './activity';
import { NativeProfileSetup } from './profile-setup';
import { createClient } from './supabase';

export function NativeAccount({
  user,
  checking,
  available,
  onSignedIn,
  activity,
  activityStatus,
  onRetryActivity,
}: {
  user: CachedIdentity | null;
  checking: boolean;
  available: boolean;
  onSignedIn: () => void;
  activity: NativeActivity | null;
  activityStatus: NativeActivityStatus | null;
  onRetryActivity: () => void;
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
      if (!activity || activity.userId !== user.id) {
        throw new Error('Account storage is unavailable. Please try again.');
      }
      await activity.signOut(async () => {
        const { error: signOutError } = await createClient().auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
      });
    } catch (cause) {
      console.error('Unable to sign out:', cause);
      setError(
        cause instanceof Error && cause.message.startsWith('Your saved changes')
          ? cause.message
          : 'Unable to sign out. Please try again.'
      );
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
        description="Sign in to keep your bookmarks and learning progress linked to your account."
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
      <NativeProfileSetup key={user.id} userId={user.id} />
      {!online && (
        <p role="status" className="text-text-secondary mt-4">
          You&apos;re offline. Your saved account is available on this device.
        </p>
      )}
      {activityStatus?.userId === user.id && activityStatus.error && (
        <p role="status" className="text-text-secondary mt-4">
          {activityStatus.error}
          {!activity && (
            <>
              {' '}
              <button type="button" className="text-accent underline" onClick={onRetryActivity}>
                Retry
              </button>
            </>
          )}
        </p>
      )}
      {(activityStatus?.userId !== user.id || !activityStatus.ready) && (
        <p role="status" className="text-text-secondary mt-4">
          Connect to set up your saved account activity on this device.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
      <Button className="mt-6" onClick={() => void signOut()} disabled={busy || !activity}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}
