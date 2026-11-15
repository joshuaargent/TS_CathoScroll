import { useEffect, useRef, useState } from 'react';
import { AccountPageSkeleton, AccountPageView } from '@/components/account/AccountPageView';
import { NativeSignin } from './signin';
import { secureAuthStorage } from './secure-auth-storage';
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
  onSignedOut,
  activity,
}: {
  user: CachedIdentity | null;
  checking: boolean;
  available: boolean;
  onSignedIn: () => void;
  onSignedOut: () => void;
  activity: NativeActivity | null;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
    const update = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      if (!connected) setMembershipUserId(null);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const accountId = user?.id;
    if (!accountId) {
      clearNativeStatusNotice('account-membership');
      return;
    }
    const userId: string = accountId;
    let active = true;
    cache.current = null;
    clearNativeStatusNotice('account-membership');
    async function loadAccount() {
      try {
        let profileCache: NativeProfileCache | null = null;
        let hasCachedProfile = false;
        try {
          const database = await openPrivateActivityDatabase(secureAuthStorage);
          profileCache = new NativeProfileCache(database);
          await profileCache.initialize();
          const cached = await profileCache.load(userId);
          if (!active) return;
          cache.current = profileCache;
          clearNativeStatusNotice('account-profile-cache:' + userId);
          if (cached) {
            hasCachedProfile = true;
            setProfile(cached);
            setProfileUserId(userId);
            clearNativeStatusNotice('account-profile-offline:' + userId);
          }
        } catch (cacheCause) {
          // Cloud account access must remain available if optional offline storage is damaged.
          console.error('Unable to open the offline profile cache:', cacheCause);
          if (active) {
            notifyNativeStatus('Offline account details are unavailable on this device.', {
              id: 'account-profile-cache:' + userId,
            });
          }
        }
        if (!navigator.onLine) {
          setVerified(false);
          setProfileUserId(userId);
          if (!hasCachedProfile) {
            notifyNativeStatus('Your saved profile is unavailable offline. Connect to load your account details.', {
              id: 'account-profile-offline:' + userId,
            });
          }
          return;
        }
        clearNativeStatusNotice('account-profile-offline:' + userId);

        const client = createClient();
        const status = await getNativeProfileStatus(client, userId);
        let latest: CachedProfile;
        if (status.exists) {
          latest = await readNativeProfile(client, userId);
        } else {
          latest = {
            username: status.suggestedUsername,
            displayName: '',
            bio: '',
          };
        }
        if (!active) return;
        setProfile(latest);
        setProfileUserId(userId);
        setProfileExists(status.exists);
        setVerified(true);
        setError('');
        try {
          if (!profileCache) throw new Error('Profile cache is unavailable.');
          await profileCache.save(userId, latest);
        } catch (cause) {
          console.error('Unable to cache account profile:', cause);
          notifyNativeStatus('Your account profile could not be saved for offline viewing.', {
            id: 'account-profile-cache:' + userId,
          });
        }

        clearNativeStatusNotice('account-profile-load:' + userId);
        try {
          const { data: membership, error: membershipError } = await client
            .from('profiles')
            .select('subscription_tier')
            .eq('id', userId)
            .maybeSingle();
          if (membershipError) throw membershipError;
          if (active) {
            setSubscriptionTier(membership?.subscription_tier ?? 'free');
            setMembershipUserId(userId);
            clearNativeStatusNotice('account-membership');
          }
        } catch (membershipCause) {
          setMembershipUserId(null);
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
        setMembershipUserId(null);
        setProfileUserId(userId);
        notifyNativeStatus('Some account details could not be refreshed. Cached details remain available where possible.', {
          id: 'account-profile-load:' + userId,
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
    const accountId = user?.id;
    if (!accountId) return;
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
      const passwordChanged = Boolean(newPassword.trim());
      if (passwordChanged && newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (passwordChanged && newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      if (!email.trim() || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim())) {
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

      // Profile, email, and password are separate Supabase mutations; report
      // partial success accurately instead of implying the whole form rolled back.
      if (passwordChanged) {
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
      onSignedOut();
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
  if (checking || (user && profileUserId !== user.id)) return <AccountPageSkeleton />;
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
    <AccountPageView
      displayName={currentProfile?.displayName ?? ''}
      username={currentProfile?.username ?? ''}
      bio={currentProfile?.bio ?? ''}
      email={email}
      newPassword={newPassword}
      confirmPassword={confirmPassword}
      membershipLabel={
        membershipUserId === user.id
          ? subscriptionTier
          : online
            ? 'Unavailable'
            : 'Connect to view membership'
      }
      saving={busy}
      signingOut={signingOut}
      saveDisabled={!canSave}
      accountSettingsDisabled={!online}
      signOutDisabled={!online}
      error={error}
      message={message}
      signOutError={signOutError}
      onDisplayNameChange={(value) => setProfile((previous) =>
        previous && profileUserId === user.id ? { ...previous, displayName: value } : previous
      )}
      onUsernameChange={(value) => setProfile((previous) =>
        previous && profileUserId === user.id ? { ...previous, username: value } : previous
      )}
      onBioChange={(value) => setProfile((previous) =>
        previous && profileUserId === user.id ? { ...previous, bio: value } : previous
      )}
      onEmailChange={(value) => {
        setEmail(value);
        setEmailChangeRequested(false);
      }}
      onNewPasswordChange={setNewPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onSave={(event) => void saveChanges(event)}
      onSignOut={() => void signOut()}
    />
  );
}
