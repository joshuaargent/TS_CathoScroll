'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { useRouter } from 'next/navigation';

import { Skeleton } from '@/components/ui/Skeleton';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

import { createClient } from '@/lib/supabase/client';

const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'support',
  'help',
  'owner',
  'root',
  'system',
  'staff',
  'moderator',
  'cathoscroll',
];

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

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
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/signin');
        return;
      }

      setEmail(user.email ?? '');

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profile) {
        setDisplayName(profile.display_name ?? '');

        setUsername(profile.username ?? '');

        setBio(profile.bio ?? '');

        setSubscriptionTier(profile.subscription_tier ?? 'free');
      }

      setLoading(false);
    }

    loadAccount();
  }, [router]);

  async function saveProfile() {
    setSaving(true);

    setError('');
    setMessage('');

    const cleanedUsername = username.trim().toLowerCase();

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (RESERVED_USERNAMES.includes(cleanedUsername)) {
      setError('That username is unavailable.');

      setSaving(false);

      return;
    }

    if (!usernameRegex.test(cleanedUsername)) {
      setError(
        'Username must be 3-20 characters and contain only letters, numbers, and underscores.'
      );

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
    setSigningOut(true);

    const supabase = createClient();

    await supabase.auth.signOut();

    router.refresh();

    router.replace('/');
  }

  if (loading) {
    return (
      <main className="container py-12">
        <div className="mt-8 mb-10">
          <Skeleton className="h-16 w-64" />

          <Skeleton className="mt-4 h-6 w-96" />
        </div>

        <div className="space-y-10">
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-8 w-48" />

              <Skeleton className="mt-3 h-5 w-72" />
            </div>

            <Skeleton className="h-9 w-40" />
          </div>

          <div className="space-y-6">
            <Skeleton className="h-12 w-full" />

            <Skeleton className="h-12 w-full" />

            <Skeleton className="h-40 w-full" />
          </div>

          <div className="space-y-6">
            <Skeleton className="h-8 w-56" />

            <Skeleton className="h-12 w-full" />

            <Skeleton className="h-12 w-full" />
          </div>

          <Skeleton className="h-24 w-full" />

          <div className="flex gap-4">
            <Skeleton className="h-12 w-40" />

            <Skeleton className="h-12 w-32" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Account</h1>

        <p className="text-text-secondary mt-4 text-lg">
          Manage your public profile, account details, and password.
        </p>
      </div>

      <div className="space-y-10">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Public Profile</h2>

              <p className="text-text-secondary mt-2">
                This is how people will see you on CathoScroll.
              </p>
            </div>

            <Link href={`/profile/${username}`}>
              <Button
                size="sm"
                style={{
                  color: '#ffffff',
                }}
              >
                View Public Profile
              </Button>
            </Link>
          </div>
        </section>

        <section className="space-y-6">
          <Input
            label="Display Name"
            value={displayName}
            disabled={saving}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <Input
            label="Username"
            value={username}
            disabled={saving}
            onChange={(e) => setUsername(e.target.value)}
            hint="3-20 characters. Used for your public profile URL."
          />

          <div className="space-y-1.5">
            <label className="text-text-primary text-sm font-medium">Bio</label>

            <textarea
              value={bio}
              maxLength={250}
              disabled={saving}
              onChange={(e) => setBio(e.target.value)}
              rows={5}
              className="border-border bg-bg-card w-full rounded-lg border p-4"
              placeholder="Tell people a little about yourself..."
            />

            <p className="text-text-muted text-sm">{bio.length}/250</p>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Account Settings</h2>

          <Input
            label="Email Address"
            type="email"
            value={email}
            disabled={saving}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            label="New Password"
            type="password"
            value={newPassword}
            disabled={saving}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="Minimum 8 characters. Leave blank to keep your current password."
          />

          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            disabled={saving}
            onChange={(e) => setConfirmPassword(e.target.value)}
            hint="Required when changing your password."
          />
        </section>

        <section>
          <div className="border-border rounded-xl border p-6">
            <p className="text-text-muted text-sm">Membership</p>

            <p className="mt-2 text-lg font-medium capitalize">{subscriptionTier}</p>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">{error}</div>
        )}

        {message && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-600">
            {message}
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <Button
            onClick={saveProfile}
            disabled={saving}
            size="lg"
            style={{
              color: '#ffffff',
            }}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>

          <Button variant="secondary" size="lg" disabled={signingOut} onClick={signOut}>
            {signingOut ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing Out...
              </>
            ) : (
              'Sign Out'
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
