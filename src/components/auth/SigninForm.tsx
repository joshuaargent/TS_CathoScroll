'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { createClient as createWebClient } from '@/lib/supabase/client';

export function SigninForm({
  onSignedIn,
  description = 'Sign in to access your account, bookmarks, learning progress, and future features.',
  allowSignup = true,
  clientFactory = createWebClient,
  online = true,
}: {
  onSignedIn: () => void;
  description?: string;
  allowSignup?: boolean;
  clientFactory?: typeof createWebClient;
  online?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading || !online) return;
    setLoading(true);
    setError('');
    try {
      const supabase = clientFactory();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        setError('Invalid email or password.');
        return;
      }
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        setError('Unable to establish session.');
        return;
      }

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
        const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
        if (factorError) throw factorError;
        const factor = factorData.totp.find((item) => item.status === 'verified');
        if (!factor) {
          setError('This account requires a second factor, but no verified authenticator is available. Contact support to recover access.');
          return;
        }
        const { data: challenge, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challengeError) throw challengeError;
        setMfaFactorId(factor.id);
        setMfaChallengeId(challenge.id);
        setMfaCode('');
        setNeedsMfa(true);
        setPassword('');
        return;
      }

      setPassword('');
      onSignedIn();
    } catch (cause) {
      console.error('Unable to sign in:', cause);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading || !/^\\d{6,8}$/.test(mfaCode.trim()) || !mfaFactorId || !mfaChallengeId) {
      setError('Enter the current six- to eight-digit authenticator code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const supabase = clientFactory();
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (verifyError) throw verifyError;
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== 'aal2') {
        throw new Error('The authenticator code was not accepted. Try again.');
      }
      setMfaCode('');
      setNeedsMfa(false);
      setMfaFactorId('');
      setMfaChallengeId('');
      onSignedIn();
    } catch (cause) {
      console.error('Unable to verify sign-in authenticator:', cause);
      setError('Unable to verify that authenticator code. Check the code and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Welcome Back</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Continue your learning journey with CathoScroll.
        </p>
      </div>
      {needsMfa ? (
        <form onSubmit={handleMfaSubmit} className="space-y-6">
          <div className="border-border rounded-2xl border p-6">
            <h2 className="text-xl font-bold">Verify your identity</h2>
            <p className="text-text-secondary mt-2 text-sm">
              This account has an authenticator enabled. Enter the current code from your authenticator app to finish signing in.
            </p>
          </div>
          <Input
            label="Authenticator code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={mfaCode}
            placeholder="000000"
            disabled={loading || !online}
            onChange={(event) => setMfaCode(event.target.value.replace(/\\D/g, '').slice(0, 8))}
            required
          />
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          <Button type="submit" size="lg" className="w-full" disabled={loading || !online} style={{ color: '#fff' }}>
            {loading ? 'Verifying…' : 'Verify and sign in'}
          </Button>
          <button type="button" className="text-accent text-sm font-medium hover:underline" disabled={loading}
            onClick={() => { setNeedsMfa(false); setMfaFactorId(''); setMfaChallengeId(''); setMfaCode(''); setError(''); }}>
            Back to password sign-in
          </button>
        </form>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="border-border rounded-2xl border p-6">
          <p className="text-text-secondary">{description}</p>
        </div>
        <Input
          label="Email"
          type="email"
          value={email}
          placeholder="you@example.com"
          autoComplete="email"
          disabled={loading || !online}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <div className="relative">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            placeholder="Enter your password"
            autoComplete="current-password"
            disabled={loading || !online}
            onChange={(event) => setPassword(event.target.value)}
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
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600"
          >
            {error}
          </div>
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
              Signing In...
            </>
          ) : (
            'Sign In'
          )}
        </Button>
        {allowSignup && (
          <div className="flex justify-center">
            <p className="text-text-secondary text-sm">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-accent font-medium hover:underline">
                Create Account
              </Link>
            </p>
          </div>
        )}
      </form>
      )}
    </div>
  );
}
