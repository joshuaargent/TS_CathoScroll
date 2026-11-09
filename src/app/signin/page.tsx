'use client';

import { useState } from 'react';

import Link from 'next/link';

import { useRouter } from 'next/navigation';

import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

import { createClient } from '@/lib/supabase/client';

export default function SigninPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    setError('');

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setError('Invalid email or password.');

        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError('Unable to establish session.');
        return;
      }

      const requestedPath = new URLSearchParams(window.location.search).get('next');
      const destination =
        requestedPath?.startsWith('/') &&
        !requestedPath.startsWith('//') &&
        !requestedPath.includes('\\')
          ? requestedPath
          : '/account';

      router.replace(destination);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Welcome Back</h1>

        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Continue your learning journey with CathoScroll.
        </p>
      </div>

      <div className="mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">
              Sign in to access your account, bookmarks, learning progress, and future features.
            </p>
          </div>

          <Input
            label="Email"
            type="email"
            value={email}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={loading}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={loading}
              onChange={(e) => setPassword(e.target.value)}
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
                Signing In...
              </>
            ) : (
              'Sign In'
            )}
          </Button>

          <div className="flex justify-center">
            <p className="text-text-secondary text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="text-accent font-medium hover:underline">
                Create Account
              </Link>
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}
