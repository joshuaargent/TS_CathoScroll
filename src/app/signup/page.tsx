'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { useRouter } from 'next/navigation';

import { SignupFormView } from '@/components/auth/SignupFormView';

import { createClient } from '@/lib/supabase/client';
import { usernameError } from '@/lib/username';

export default function SignupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setLoading(true);

    setError('');

    const username = (formData.get('username') as string).trim().toLowerCase();

    const email = (formData.get('email') as string).trim().toLowerCase();

    const password = formData.get('password') as string;

    const confirmPassword = formData.get('confirmPassword') as string;

    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      setError(invalidUsername);

      setLoading(false);

      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');

      setLoading(false);

      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');

      setLoading(false);

      return;
    }

    try {
      const supabase = createClient();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            display_name: username,
          },
        },
      });

      if (error) {
        setError('Unable to create account.');

        return;
      }

      if (!data.user) {
        setError('Unable to create account.');

        return;
      }

      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,

        username,

        display_name: username,
      });

      if (profileError) {
        if (profileError.code === '23505') {
          setError('That username is already taken.');
        } else {
          setError('Something went wrong while setting up your profile.');
        }

        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError('Unable to establish session.');
        return;
      }

      router.replace('/account');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SignupFormView
      loading={loading}
      error={error}
      online
      confirmation={false}
      showPassword={showPassword}
      showConfirmPassword={showConfirmPassword}
      onTogglePassword={() => setShowPassword((value) => !value)}
      onToggleConfirmPassword={() => setShowConfirmPassword((value) => !value)}
      onSubmit={(event) => void handleSubmit(event)}
    />
  );
}
