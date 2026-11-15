import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { NativeSignin } from './signin';
import { secureAuthStorage } from './secure-auth-storage';
import { Input } from '@/components/ui/Input';
import type { CachedIdentity } from './cached-identity';
import type { NativeActivity } from './activity';
import { createClient } from './supabase';
import { useNativeNotifications } from './notifications';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';
import { openPrivateActivityDatabase } from '@/lib/offline/native-database';
import { NativeProfileCache, type CachedProfile } from './profile-cache';
import {
  createNativeProfile,
  getNativeProfileStatus,
  readNativeProfile,
  updateNativeEmail,
  updateNativePassword,
  updateNativeProfile,
} from './profile';
import { usernameError } from '@/lib/username';

export function NativeAccount({
  user,
  checking,
  available,
  onSignedIn,
  activity,
}: {
  user: CachedIdentity | null;
  checking: boolean;
  available: boolean;
  onSignedIn: () => void;
  activity: NativeActivity | null;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [profileExists, setProfileExists] = useState(true);
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [email, setEmail] = useState(user?.email ?? '');
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [membershipUserId, setMembershipUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [emailChangeRequested, setEmailChangeRequested] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const cache = useRef<NativeProfileCache | null>(null);
  const notifications = useNativeNotifications();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      clearNativeStatusNotice('account-membership');
      setProfile(null);
      setProfileUserId(null);
      setMembershipUserId(null);
      setLoading(false);
      return;
    }
    const accountId = user.id;
    let active = true;
    setEmail(user.email ?? '');
    setEmailChangeRequested(false);
    setVerified(false);
    setMembershipUserId(null);
    setLoading(true);
    async function loadAccount() {
      try {
        let profileCache: NativeProfileCache | null = null;
        try {
          const database = await openPrivateActivityDatabase(secureAuthStorage);
          profileCache = new NativeProfileCache(database);
          await profileCache.initialize();
          const cached = await profileCache.load(accountId);
          if (!active) return;
          cache.current = profileCache;
          if (cached) {
            setProfile(cached);
            setProfileUserId(accountId);
          }
        } catch (cacheCause) {
          // Cloud account access must remain available if optional offline storage is damaged.
          console.error('Unable to open the offline profile cache:', cacheCause);
          if (active) {
            notifyNativeStatus('Offline account details are unavailable on this device.', {
              id: 'account-profile-cache:' + accountId,
            });
          }
        }
        if (!navigator.onLine) {
          setVerified(false);
          setLoading(false);
          return;
        }

        const client = createClient();
        const status = await getNativeProfileStatus(client, accountId);
        let latest: CachedProfile;
        if (status.exists) {
          latest = await readNativeProfile(client, accountId);
        } else {
          latest = {
            username: status.suggestedUsername,
            displayName: '',
            bio: '',
          };
        }
        if (!active) return;
        setProfile(latest);
        setProfileUserId(accountId);
        setProfileExists(status.exists);
        setVerified(true);
        setError('');
        setLoading(false);
        try {
          if (!profileCache) throw new Error('Profile cache is unavailable.');
          await profileCache.save(accountId, latest);
        } catch (cause) {
          console.error('Unable to cache account profile:', cause);
          notifyNativeStatus('Your account profile could not be saved for offline viewing.', {
            id: 'account-profile-cache:' + accountId,
          });
        }

        clearNativeStatusNotice('account-profile-load:' + accountId);
        try {
          const { data: membership, error: membershipError } = await client
            .from('profiles')
            .select('subscription_tier')
            .eq('id', accountId)
            .maybeSingle();
          if (membershipError) throw membershipError;
          if (active) {
            setSubscriptionTier(membership?.subscription_tier ?? 'free');
            setMembershipUserId(accountId);
            clearNativeStatusNotice('account-membership');
          }
        } catch (membershipCause) {
          console.error('Unable to load account membership:', membershipCause);
          if (active) {
            notifyNativeStatus('Your membership details could not be loaded.', {
              id: 'account-membership',
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        }
      } catch (cause) {
        console.error('Unable to load account details:', cause);
        if (!active) return;
        setVerified(false);
        setLoading(false);
        notifyNativeStatus('Some account details could not be refreshed. Cached details remain available where possible.', {
          id: 'account-profile-load:' + accountId,
          action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
        });
      }
    }
    void loadAccount();
    return () => {
      active = false;
    };
  }, [user?.id, online, attempt]);

  useEffect(() => {
    if (!user) return;
    if (!online) {
      notifyNativeStatus('Connect to the internet to view your latest membership details.', {
        id: 'account-membership',
      });
    }
  }, [user?.id, online]);

  async function saveChanges(event: React.FormEvent) {
    event.preventDefault();
    if (!user || profileUserId !== user.id || !profile || !verified || !navigator.onLine || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const usernameValidation = usernameError(profile.username.trim().toLowerCase());
      if (usernameValidation) throw new Error(usernameValidation);
      if (profile.displayName.trim().length < 2) {
        throw new Error('Display name must be at least 2 characters.');
      }
      if (profile.bio.length > 250) throw new Error('Bio cannot exceed 250 characters.');
      if (newPassword && newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (newPassword && newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      if (email.trim() && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim())) {
        throw new Error('Enter a valid email address.');
      }

      const client = createClient();
      if (!profileExists) {
        const created = await createNativeProfile(client, user.id, profile.username);
        if (created === 'taken') {
          setError('That username is already taken.');
          return;
        }
        setProfileExists(true);
      }

      const profileResult = await updateNativeProfile(client, user.id, profile);
      if (profileResult.status === 'taken') {
        setError('That username is already taken.');
        return;
      }
      const updatedProfile = profileResult.profile;
      setProfile(updatedProfile);
      try {
        if (!cache.current) throw new Error('Profile cache is unavailable.');
        await cache.current.save(user.id, updatedProfile);
      } catch (cause) {
        console.error('Unable to cache saved account profile:', cause);
        notifyNativeStatus('Your profile was saved online but could not be cached for offline viewing.', {
          id: 'account-profile-cache:' + user.id,
        });
      }

      let partialSave = false;
      if (!emailChangeRequested && email.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) {
        try {
          await updateNativeEmail(client, user.id, email);
          setEmailChangeRequested(true);
        } catch (cause) {
          partialSave = true;
          setError(cause instanceof Error ? cause.message : 'Your profile was saved, but your email could not be changed.');
        }
      }

      if (newPassword) {
        try {
          await updateNativePassword(client, user.id, newPassword, confirmPassword);
          setNewPassword('');
          setConfirmPassword('');
        } catch (cause) {
          partialSave = true;
          setError(cause instanceof Error ? cause.message : 'Your profile was saved, but your password could not be changed.');
        }
      }

      if (!partialSave) {
        setMessage(emailChangeRequested || email.trim().toLowerCase() !== (user.email ?? '').toLowerCase()
          ? 'Your changes have been saved. Check your email for confirmation instructions.'
          : 'Your changes have been saved.');
      } else {
        setMessage('Your profile changes were saved. Review the account security error above.');
      }
    } catch (cause) {
      console.error('Unable to save account changes:', cause);
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!user || signingOut) return;
    if (!navigator.onLine) {
      setSignOutError('Connect to the internet before signing out.');
      return;
    }
    setSigningOut(true);
    setSignOutError('');
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
      setSignOutError(
        cause instanceof Error && cause.message.startsWith('Your saved changes')
          ? cause.message
          : 'Unable to sign out. Please try again.'
      );
    } finally {
      setSigningOut(false);
    }
  }

  if (!available) return null;
  if (checking || loading && !profile) return <p className="container py-12">Loading account…</p>;
  if (!user) {
    return online ? (
      <NativeSignin
        onSignedIn={onSignedIn}
        description="Sign in to keep your bookmarks and learning progress linked to your account."
      />
    ) : null;
  }

  const currentProfile = profileUserId === user.id ? profile : null;
  const canSave = online && verified && Boolean(currentProfile) && !busy;
  return (
    <div className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Account</h1>
        <p className="text-text-secondary mt-4 text-lg">
          Manage your public profile, account details, and password.
        </p>
      </div>

      <form onSubmit={(event) => void saveChanges(event)} className="space-y-10">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Public Profile</h2>
              <p className="text-text-secondary mt-2">
                This is how people will see you on CathoScroll.
              </p>
            </div>
            {currentProfile?.username && (
              <Link href={'/profile/' + encodeURIComponent(currentProfile.username)}>
                <Button
                  size="sm"
                  style={{ color: '#ffffff' }}
                >
                  View Public Profile
                </Button>
              </Link>
            )}
          </div>
        </section>

        {!currentProfile && (
          <p role="status" className="text-text-secondary">
            Your saved profile is unavailable. Connect to load your account details.
          </p>
        )}
        {currentProfile && (
          <section className="space-y-6">
            <Input
              label="Display Name"
              value={currentProfile.displayName}
              disabled={!canSave}
              onChange={(event) => setProfile({ ...currentProfile, displayName: event.target.value })}
            />
            <Input
              label="Username"
              value={currentProfile.username}
              disabled={!canSave}
              onChange={(event) => setProfile({ ...currentProfile, username: event.target.value })}
              hint="3-20 characters. Used for your public profile URL."
            />
            <div className="space-y-1.5">
              <label className="text-text-primary text-sm font-medium" htmlFor="account-bio">Bio</label>
              <textarea
                id="account-bio"
                value={currentProfile.bio}
                maxLength={250}
                disabled={!canSave}
                onChange={(event) => setProfile({ ...currentProfile, bio: event.target.value })}
                rows={5}
                className="border-border bg-bg-card w-full rounded-lg border p-4"
                placeholder="Tell people a little about yourself..."
              />
              <p className="text-text-muted text-sm">{currentProfile.bio.length}/250</p>
            </div>
          </section>
        )}

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Account Settings</h2>
          <Input
            label="Email Address"
            type="email"
            value={email}
            disabled={!online || busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            disabled={!online || busy}
            onChange={(event) => setNewPassword(event.target.value)}
            hint="Minimum 8 characters. Leave blank to keep your current password."
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            disabled={!online || busy}
            onChange={(event) => setConfirmPassword(event.target.value)}
            hint="Required when changing your password."
          />
        </section>

        <section>
          <div className="border-border rounded-xl border p-6">
            <p className="text-text-muted text-sm">Membership</p>
            <p className="mt-2 text-lg font-medium capitalize">
              {membershipUserId === user.id
                ? subscriptionTier
                : online
                  ? 'Unavailable'
                  : 'Connect to view membership'}
            </p>
          </div>
        </section>

        {!verified && (
          <p role="status" className="text-text-secondary text-sm">
            {online
              ? 'Your latest account details could not be verified. Reconnect and retry before saving.'
              : 'You are offline. Saved profile details are read-only until you reconnect.'}
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-600">
            {message}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <Button type="submit" disabled={!canSave} size="lg">
            {busy ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button type="button" variant="secondary" size="lg" disabled={signingOut || !online} onClick={() => void signOut()}>
            {signingOut ? 'Signing Out…' : 'Sign Out'}
          </Button>
        </div>
        {signOutError && <p role="alert" className="text-sm text-red-600">{signOutError}</p>}
      </form>
    </div>
  );
}
