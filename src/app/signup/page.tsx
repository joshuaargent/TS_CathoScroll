'use client';

import { useState } from 'react';

import Link from 'next/link';

import { useRouter } from 'next/navigation';

import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

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

export default function SignupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);

    setError('');

    const username = (formData.get('username') as string).trim().toLowerCase();

    const email = (formData.get('email') as string).trim().toLowerCase();

    const password = formData.get('password') as string;

    const confirmPassword = formData.get('confirmPassword') as string;

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (RESERVED_USERNAMES.includes(username)) {
      setError('That username is unavailable.');

      setLoading(false);

      return;
    }

    if (!usernameRegex.test(username)) {
      setError(
        'Username must be 3-20 characters and contain only letters, numbers, and underscores.'
      );

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

        subscription_tier: 'free',
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
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Join CathoScroll</h1>

        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Start your learning journey with CathoScroll.
        </p>
      </div>

      <div className="mx-auto">
        <form action={handleSubmit} className="space-y-6">
          <div className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">
              Free accounts include saved bookmarks, learning progress, and access to future
              community features.
            </p>
          </div>

          <Input
            label="Username"
            name="username"
            type="text"
            placeholder="username"
            hint="3-20 characters. Letters, numbers and underscores only."
            disabled={loading}
            required
          />

          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            disabled={loading}
            required
          />

          <div className="relative">
            <Input
              label="Password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a password"
              autoComplete="new-password"
              hint="Minimum 8 characters."
              disabled={loading}
              required
            />

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-text-muted hover:text-text-primary absolute top-[38px] right-3"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          <div className="relative">
            <Input
              label="Confirm Password"
              name="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="Confirm your password"
              autoComplete="new-password"
              disabled={loading}
              required
            />

            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="text-text-muted hover:text-text-primary absolute top-[38px] right-3"
            >
              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading}
            style={{
              color: '#fff',
            }}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              'Create Account'
            )}
          </Button>

          <div className="flex justify-center">
            <p className="text-text-secondary text-sm">
              Already have an account?{' '}
              <Link href="/signin" className="text-accent font-medium hover:underline">
                Sign In
              </Link>
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}
