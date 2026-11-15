import { useEffect, useState } from 'react';
import type { CachedIdentity } from './cached-identity';
import { SigninForm } from '@/components/auth/SigninForm';
import { Button } from '@/components/ui/Button';
import type { NativeActivity, NativeActivityStatus } from './activity';
import { NativeProfileSetup } from './profile-setup';
import { NativeAccountSecurity } from './account-security';
import { createClient } from './supabase';
import { useNativeNotifications } from './notifications';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

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
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [membershipLoaded, setMembershipLoaded] = useState(false);
  const notifications = useNativeNotifications();

  useEffect(() => {
    if (!user) {
      setMembershipLoaded(false);
      clearNativeStatusNotice('account-activity-setup');
      clearNativeStatusNotice('account-membership');
      return;
    }
    let active = true;
    async function loadMembership() {
      if (!navigator.onLine) return;
      setMembershipLoaded(false);
      try {
        const { data, error: profileError } = await createClient()
          .from('profiles')
          .select('subscription_tier')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (active) {
          setSubscriptionTier(data?.subscription_tier ?? 'free');
          setMembershipLoaded(true);
        }
        clearNativeStatusNotice('account-membership');
      } catch (cause) {
        console.error('Unable to load account membership:', cause);
        if (active) {
          setMembershipLoaded(false);
          notifyNativeStatus('Your membership details could not be loaded.', { id: 'account-membership' });
        }
      }
    }
    void loadMembership();
    return () => { active = false; };
  }, [user?.id, online]);

  useEffect(() => {
    if (!user && !online) {
      notifyNativeStatus('Connect to the internet to sign in.', { id: 'signin-offline' });
    } else {
      clearNativeStatusNotice('signin-offline');
    }
  }, [user?.id, online]);

  useEffect(() => {
    if (!available) {
      notifyNativeStatus('Sign-in is unavailable. Check your connection and restart the app if the problem continues. Saved offline changes have not been removed.', {
        id: 'auth-unavailable',
      });
    } else {
      clearNativeStatusNotice('auth-unavailable');
    }
  }, [available]);

  useEffect(() => {
    if (!user) return;
    if (activityStatus?.userId === user.id && activityStatus.error) {
      notifyNativeStatus(activityStatus.error, {
        id: 'account-activity-setup',
        action: activity ? undefined : { label: 'Retry', onClick: onRetryActivity },
      });
    } else if (activityStatus?.userId === user.id && activityStatus.ready) {
      clearNativeStatusNotice('account-activity-setup');
    }
  }, [user?.id, activityStatus, activity, onRetryActivity]);

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
        if (!notifications?.service || notifications.userId !== user.id) {
          throw new Error('Account storage is unavailable. Please try again.');
        }
        await notifications.service.ensureNoPending();
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

  if (!available) return null;
  if (checking) return <p className="container py-12">Loading account…</p>;
  if (!user) {
    return online ? (
      <SigninForm
        onSignedIn={onSignedIn}
        description="Sign in to keep your bookmarks and learning progress linked to your account."
      />
    ) : null;
  }
  return (
    <div className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Account</h1>
        <p className="text-text-secondary mt-4 text-lg">
          Manage your public profile, account details, and password.
        </p>
      </div>
      <NativeProfileSetup key={user.id} userId={user.id} />
      <NativeAccountSecurity key={user.id} userId={user.id} currentEmail={user.email ?? ''} />
      <section className="border-border mt-6 rounded-xl border p-6">
        <p className="text-text-muted text-sm">Membership</p>
        <p className="mt-2 text-lg font-medium capitalize">{membershipLoaded ? subscriptionTier : online ? "Unavailable" : "Connect to view membership"}</p>
      </section>
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
