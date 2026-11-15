import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createNativeProfile, getNativeProfileStatus } from './profile';
import { createClient } from './supabase';
import { NativeProfileSettings } from './profile-settings';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

export function NativeProfileSetup({ userId }: { userId: string }) {
  const [status, setStatus] = useState<'loading' | 'complete' | 'missing' | 'offline' | 'error'>(
    'loading'
  );
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const noticeId = 'profile-setup:' + userId;
    if (status === 'error') {
      notifyNativeStatus('Unable to check your profile. Please try again.', {
        id: noticeId,
        action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
      });
    } else if (status === 'complete' || status === 'missing' || status === 'offline') {
      clearNativeStatusNotice(noticeId);
    }
  }, [status, userId]);

  useEffect(() => {
    let active = true;
    async function check() {
      if (!navigator.onLine) {
        if (active) setStatus('offline');
        return;
      }
      try {
        const result = await getNativeProfileStatus(createClient(), userId);
        if (active) {
          setUsername(result.suggestedUsername);
          setStatus(result.exists ? 'complete' : 'missing');
        }
      } catch (cause) {
        console.error('Unable to check your profile:', cause);
        if (active) setStatus('error');
      }
    }
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    void check();
    return () => {
      active = false;
      window.removeEventListener('online', retry);
    };
  }, [userId, attempt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await createNativeProfile(createClient(), userId, username);
      if (result === 'taken') {
        setError('That username is already taken. Please choose another.');
      } else {
        setStatus('complete');
      }
    } catch (cause) {
      console.error('Unable to create your profile:', cause);
      setError(
        cause instanceof Error && cause.message.startsWith('Username must')
          ? cause.message
          : cause instanceof Error && cause.message === 'That username is unavailable.'
            ? cause.message
            : 'Unable to set up your profile. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === 'complete') return <NativeProfileSettings userId={userId} />;
  if (status === 'loading')
    return <p className="text-text-secondary mt-4">Checking your profile…</p>;
  if (status === 'offline') {
    return <NativeProfileSettings userId={userId} />;
  }
  if (status === 'error') return <NativeProfileSettings userId={userId} />;
  return (
    <form onSubmit={submit} className="border-border mt-6 space-y-4 rounded-2xl border p-6">
      <h2 className="text-xl font-bold">Complete your profile</h2>
      <p className="text-text-secondary">Choose a username to finish setting up your account.</p>
      <Input
        label="Username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        hint="3-20 characters. Letters, numbers and underscores only."
        disabled={busy}
        required
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Complete profile'}
      </Button>
    </form>
  );
}
