import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { usernameError } from '@/lib/username';
import { createClient } from './supabase';

export function NativeSignup({ onSignedUp }: { onSignedUp: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

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
    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      setError(invalidUsername);
      return;
    }
    if (password.length < 8 || password !== confirmPassword) {
      setError(
        password.length < 8 ? 'Password must be at least 8 characters.' : 'Passwords do not match.'
      );
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: result, error: signupError } = await createClient().auth.signUp({
        email,
        password,
        options: { data: { username, display_name: username } },
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
    <div className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Join CathoScroll</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Start your learning journey with CathoScroll.
        </p>
      </div>
      {confirmation ? (
        <div role="status" className="border-border rounded-2xl border p-6">
          <p>
            Check your email for a confirmation link. After confirming, return to the app and sign
            in to finish setting up your profile.
          </p>
          <Link href="/signin" className="text-accent mt-4 inline-block underline">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-6">
          <div className="border-border rounded-2xl border p-6">
            <p className="text-text-secondary">
              Free accounts include saved bookmarks, learning progress, and access to community
              features.
            </p>
          </div>
          {!online && <p role="status">Connect to the internet to create an account.</p>}
          <Input
            label="Username"
            name="username"
            type="text"
            hint="3-20 characters. Letters, numbers and underscores only."
            disabled={loading}
            required
          />
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            disabled={loading}
            required
          />
          <div className="relative">
            <Input
              label="Password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              hint="Minimum 8 characters."
              disabled={loading}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="text-text-muted hover:text-text-primary absolute top-[38px] right-3"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="relative">
            <Input
              label="Confirm Password"
              name="confirmPassword"
              type={showConfirmation ? 'text' : 'password'}
              autoComplete="new-password"
              disabled={loading}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmation(!showConfirmation)}
              aria-label={
                showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'
              }
              className="text-text-muted hover:text-text-primary absolute top-[38px] right-3"
            >
              {showConfirmation ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || !online}
            style={{ color: '#fff' }}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account…
              </>
            ) : (
              'Create Account'
            )}
          </Button>
          <p className="text-text-secondary text-center text-sm">
            Already have an account?{' '}
            <Link href="/signin" className="text-accent font-medium hover:underline">
              Sign In
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
