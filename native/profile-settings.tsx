import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { openPrivateActivityDatabase } from '@/lib/offline/native-database';
import { NativeProfileCache, type CachedProfile } from './profile-cache';
import { secureAuthStorage } from './secure-auth-storage';
import { createClient } from './supabase';
import { readNativeProfile, updateNativeProfile } from './profile';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';
import { Skeleton } from '@/components/ui/Skeleton';

export function NativeProfileSettings({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const cache = useRef<NativeProfileCache | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const noticeId = 'profile-offline:' + userId;
    if (!navigator.onLine) {
      notifyNativeStatus('Profile settings are read-only until you reconnect.', {
        id: noticeId,
      });
    } else {
      clearNativeStatusNotice(noticeId);
    }
    return () => clearNativeStatusNotice(noticeId);
  }, [userId, attempt]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const store = new NativeProfileCache(await openPrivateActivityDatabase(secureAuthStorage));
        await store.initialize();
        const cached = await store.load(userId);
        if (!active) return;
        cache.current = store;
        if (cached && !dirty.current) setProfile(cached);
        if (!navigator.onLine) {
          setVerified(false);
          setLoading(false);
          return;
        }
        const latest = await readNativeProfile(createClient(), userId);
        if (active) {
          if (!dirty.current) setProfile(latest);
          setVerified(true);
          setError('');
          clearNativeStatusNotice('profile-load:' + userId);
          setLoading(false);
        }
        try {
          await store.save(userId, latest);
        } catch (cause) {
          console.error('Unable to cache account settings:', cause);
          if (active) notifyNativeStatus('Your profile could not be saved for offline viewing.', { id: 'profile-cache:' + userId });
        }
      } catch (cause) {
        console.error('Unable to load account settings:', cause);
        if (active) {
          setVerified(false);
          notifyNativeStatus('Account settings could not be refreshed. Check your connection and try again.', {
            id: 'profile-load:' + userId,
            action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
          });
          setLoading(false);
        }
      }
    }
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    void load();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, [userId, attempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !verified || !navigator.onLine || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await updateNativeProfile(createClient(), userId, profile);
      if (result.status === 'taken') {
        setError('That username is already taken.');
        return;
      }
      const updated = result.profile;
      dirty.current = false;
      setProfile(updated);
      setMessage('Profile saved.');
      try {
        if (!cache.current) throw new Error('Profile cache is unavailable.');
        await cache.current.save(userId, updated);
      } catch (cause) {
        console.error('Unable to cache account settings:', cause);
        notifyNativeStatus('Profile saved online, but it could not be saved for offline viewing.', { id: 'profile-cache:' + userId });
      }
    } catch (cause) {
      console.error('Unable to save account settings:', cause);
      const validationMessages = [
        'That username is unavailable.',
        'Username must be 3-20 characters and contain only letters, numbers, and underscores.',
        'Display name must be at least 2 characters.',
        'Bio cannot exceed 250 characters.',
      ];
      if (cause instanceof Error && validationMessages.includes(cause.message)) {
        setError(cause.message);
      } else {
        notifyNativeStatus('Unable to save your profile. Please try again.', {
          id: 'profile-save:' + userId,
          action: { label: 'Retry', onClick: () => formRef.current?.requestSubmit() },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && !profile) return (
    <section role="status" aria-label="Loading profile settings" aria-busy="true" className="mt-6 space-y-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-28 w-full" variant="rectangular" />
    </section>
  );
  if (!profile) return null;
  const disabled = !verified || busy;
  return (
    <form
      ref={formRef}
      onSubmit={(event) => void save(event)}
      className="border-border mt-6 space-y-4 rounded-2xl border p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Public Profile</h2>
          <p className="text-text-secondary mt-1 text-sm">
            This is how people will see you on CathoScroll.
          </p>
        </div>
        <Link
          href={'/profile/' + encodeURIComponent(profile.username)}
          className="text-accent text-sm font-medium underline"
        >
          View Public Profile
        </Link>
      </div>
      <Input
        label="Username"
        value={profile.username}
        disabled={disabled}
        onChange={(event) => {
          dirty.current = true;
          setProfile({ ...profile, username: event.target.value });
        }}
        hint="3-20 characters. Used for your public profile URL."
      />
      <Input
        label="Display name"
        value={profile.displayName}
        disabled={disabled}
        onChange={(event) => {
          dirty.current = true;
          setProfile({ ...profile, displayName: event.target.value });
        }}
      />
      <label className="block text-sm font-medium" htmlFor="native-profile-bio">
        Bio
      </label>
      <textarea
        id="native-profile-bio"
        value={profile.bio}
        disabled={disabled}
        maxLength={250}
        onChange={(event) => {
          dirty.current = true;
          setProfile({ ...profile, bio: event.target.value });
        }}
        className="border-border bg-bg-primary w-full rounded-xl border p-3"
        placeholder="Tell people a little about yourself..."
        rows={5}
      />
      <p className="text-text-muted text-sm">{profile.bio.length}/250</p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}{' '}
          {!verified && (
            <button
              type="button"
              className="underline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button type="submit" disabled={disabled}>
        {busy ? 'Saving…' : 'Save profile'}
      </Button>
      <div className="border-border border-t pt-4">
        <h3 className="font-semibold">Personalisation and privacy</h3>
        <p className="text-text-secondary mt-1 text-sm">
          Manage optional private interest profiling and personalised topic recommendations.
        </p>
        <Link href="/account/personalization" className="text-accent mt-3 inline-flex text-sm font-semibold underline">
          Manage personalisation
        </Link>
      </div>
    </form>
  );
}
