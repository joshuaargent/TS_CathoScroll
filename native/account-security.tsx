import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { updateNativeEmail, updateNativePassword } from './profile';
import { createClient } from './supabase';

export function NativeAccountSecurity({ userId }: { userId: string }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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

  async function submit(event: React.FormEvent, action: 'email' | 'password') {
    event.preventDefault();
    if (busy) return;
    if (!navigator.onLine) {
      setError('Connect to the internet to change your account details.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'email') {
        await updateNativeEmail(createClient(), userId, email);
        setEmail('');
        setMessage('Email change requested. Check your email for any confirmation instructions.');
      } else {
        await updateNativePassword(createClient(), userId, password, confirmation);
        setPassword('');
        setConfirmation('');
        setMessage('Password updated.');
      }
    } catch (cause) {
      console.error('Unable to update account security:', cause);
      setError(
        cause instanceof Error ? cause.message : 'Unable to update your account. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border mt-6 space-y-5 rounded-2xl border p-6">
      <h2 className="text-xl font-bold">Account security</h2>
      {!online && <p role="status">Connect to the internet to change your account details.</p>}
      <form onSubmit={(event) => void submit(event, 'email')} className="space-y-3">
        <Input
          label="New email address"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={!online || busy}
          required
        />
        <Button type="submit" disabled={!online || busy}>
          Change email
        </Button>
      </form>
      <form onSubmit={(event) => void submit(event, 'password')} className="space-y-3">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={!online || busy}
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={!online || busy}
          required
        />
        <Button type="submit" disabled={!online || busy}>
          Change password
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
