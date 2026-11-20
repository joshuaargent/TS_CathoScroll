import { useEffect, useState } from 'react';
import { SignupFormView } from '@/components/auth/SignupFormView';
import { usernameError } from '@/lib/username';
import { createClient } from './supabase';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

export function NativeSignup({ onSignedUp }: { onSignedUp: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    if (!online) {
      notifyNativeStatus('Connect to the internet to create an account.', { id: 'signup-offline' });
    } else {
      clearNativeStatusNotice('signup-offline');
    }
  }, [online]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get('username') ?? '')
      .trim()
      .toLowerCase();
    const email = String(data.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(data.get('password') ?? '');
    const confirmPassword = String(data.get('confirmPassword') ?? '');
    const personalizationConsent = data.get('personalizationConsent') === 'true';
    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      setError(invalidUsername);
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: result, error: signupError } = await createClient().auth.signUp({
        email,
        password,
        options: { data: { username, display_name: username, personalization_consent: personalizationConsent, personalization_consent_version: personalizationConsent ? '2026-11-20-v4' : null } },
      });
      if (signupError) throw signupError;
      if (result.session) {
        onSignedUp();
      } else {
        setConfirmation(true);
      }
    } catch (cause) {
      console.error('Unable to create account:', cause);
      setError('Unable to create your account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SignupFormView
      loading={loading}
      error={error}
      online={online}
      confirmation={confirmation}
      showPassword={showPassword}
      showConfirmPassword={showConfirmation}
      onTogglePassword={() => setShowPassword((value) => !value)}
      onToggleConfirmPassword={() => setShowConfirmation((value) => !value)}
      onSubmit={(event) => void submit(event)}
    />
  );
}
