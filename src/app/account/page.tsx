'use client';

import { useEffect, useState } from 'react';


import { useRouter } from 'next/navigation';

import { AccountPageView } from '@/components/account/AccountPageView';

import { createClient } from '@/lib/supabase/client';
import { usernameError } from '@/lib/username';

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [loadFailed, setLoadFailed] = useState(false);

  const [saving, setSaving] = useState(false);

  const [signingOut, setSigningOut] = useState(false);

  const [message, setMessage] = useState('');

  const [error, setError] = useState('');

  const [email, setEmail] = useState('');

  const [displayName, setDisplayName] = useState('');

  const [username, setUsername] = useState('');

  const [bio, setBio] = useState('');

  const [subscriptionTier, setSubscriptionTier] = useState('free');

  const [newPassword, setNewPassword] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    async function loadAccount() {
      setError('');
      setLoadFailed(false);
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        if (!user) {
          router.replace('/signin');
          return;
        }

        setEmail(user.email ?? '');

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (profileError) throw profileError;
        if (!profile) throw new Error('Account profile is missing.');

        setDisplayName(profile.display_name ?? '');
        setUsername(profile.username ?? '');
        setBio(profile.bio ?? '');
        setSubscriptionTier(profile.subscription_tier ?? 'free');
      } catch (cause) {
        console.error('Unable to load account:', cause);
        setLoadFailed(true);
        setError('Unable to load your account details. Refresh the page to try again.');
      } finally {
        setLoading(false);
      }
    }

    void loadAccount();
  }, [router]);

  async function saveProfile() {
    if (loadFailed || saving || signingOut) return;
    setSaving(true);

    setError('');
    setMessage('');

    const cleanedUsername = username.trim().toLowerCase();

    const invalidUsername = usernameError(cleanedUsername);
    if (invalidUsername) {
      setError(invalidUsername);

      setSaving(false);

      return;
    }

    if (displayName.trim().length < 2) {
      setError('Display name must be at least 2 characters.');

      setSaving(false);

      return;
    }

    if (bio.length > 250) {
      setError('Bio cannot exceed 250 characters.');

      setSaving(false);

      return;
    }

    if (newPassword && newPassword.length < 8) {
      setError('Password must be at least 8 characters.');

      setSaving(false);

      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      setError('Passwords do not match.');

      setSaving(false);

      return;
    }

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('You are not signed in.');

        return;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),

          username: cleanedUsername,

          bio: bio.trim() || null,
        })
        .eq('id', user.id);

      if (profileError) {
        if (profileError.code === '23505') {
          setError('That username is already taken.');
        } else {
          setError('Unable to save profile.');
        }

        return;
      }

      if (email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: email.trim().toLowerCase(),
        });

        if (emailError) {
          setError(emailError.message);

          return;
        }
      }

      if (newPassword.trim()) {
        const { error: passwordError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (passwordError) {
          setError(passwordError.message);

          return;
        }
      }

      setNewPassword('');
      setConfirmPassword('');

      setMessage('Your changes have been saved.');

      router.refresh();
    } catch {
      setError('Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      router.refresh();
      router.replace('/');
    } catch (cause) {
      console.error('Unable to sign out:', cause);
      setError('Unable to sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main>
    <AccountPageView
      loading={loading}
      displayName={displayName}
      username={username}
      bio={bio}
      email={email}
      newPassword={newPassword}
      confirmPassword={confirmPassword}
      membershipLabel={subscriptionTier}
      saving={saving}
      signingOut={signingOut}
      saveDisabled={loadFailed}
      profileFieldsDisabled={loadFailed}
      accountSettingsDisabled={loadFailed}
      signOutDisabled={false}
      error={error}
      message={message}
      onDisplayNameChange={setDisplayName}
      onUsernameChange={setUsername}
      onBioChange={setBio}
      onEmailChange={setEmail}
      onNewPasswordChange={setNewPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onSave={(event) => {
        event.preventDefault();
        void saveProfile();
      }}
      onSignOut={() => void signOut()}
    />
    </main>
  );
}
