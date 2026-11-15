'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

interface TotpFactor {
  id: string;
  status: 'verified' | 'unverified';
  friendly_name?: string | null;
}

interface AssuranceState {
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2';
}

export default function AccountSecurityPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [assurance, setAssurance] = useState<AssuranceState | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [enforcementEnabled, setEnforcementEnabled] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [flow, setFlow] = useState<'enroll' | 'challenge' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const verifiedFactors = useMemo(
    () => factors.filter((factor) => factor.status === 'verified'),
    [factors]
  );
  const unverifiedFactors = useMemo(
    () => factors.filter((factor) => factor.status === 'unverified'),
    [factors]
  );

  const refreshSecurityState = useCallback(async () => {
    const supabase = createClient();
    const [{ data: userData, error: userError }, { data: factorData, error: factorError }, { data: assuranceData, error: assuranceError }] =
      await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

    if (userError) throw userError;
    if (factorError) throw factorError;
    if (assuranceError) throw assuranceError;
    if (!userData.user) throw new Error('Sign in to manage account security.');

    setFactors((factorData.totp ?? []) as TotpFactor[]);
    setAssurance(assuranceData as AssuranceState);

    const response = await fetch('/api/admin/security/mfa-enforcement', {
      method: 'GET',
      cache: 'no-store',
    });
    if (response.ok) {
      const status = (await response.json()) as {
        isOwner?: boolean;
        enforcementEnabled?: boolean;
      };
      setIsOwner(status.isOwner === true);
      setEnforcementEnabled(status.enforcementEnabled === true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await refreshSecurityState();
      } catch (cause) {
        if (active) {
          console.error('Unable to load account security:', cause);
          setError('Unable to load authenticator settings. Refresh the page to try again.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSecurityState]);

  async function beginEnrollment() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const supabase = createClient();

      // Remove abandoned, unverified setup attempts before creating a fresh
      // secret. Verified factors are never removed from this screen.
      for (const factor of unverifiedFactors) {
        const { error: removeError } = await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });
        if (removeError) throw removeError;
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'CathoScroll authenticator',
      });
      if (enrollError) throw enrollError;

      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFlow('enroll');

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: data.id });
      if (challengeError) throw challengeError;
      setChallengeId(challenge.id);
      setMessage('Scan the QR code with an authenticator app, then enter its current six-digit code.');
    } catch (cause) {
      console.error('Unable to start authenticator enrollment:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to start authenticator setup.');
    } finally {
      setBusy(false);
    }
  }

  async function beginChallenge(selectedFactorId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const supabase = createClient();
      const { data, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: selectedFactorId,
      });
      if (challengeError) throw challengeError;
      setFactorId(selectedFactorId);
      setChallengeId(data.id);
      setFlow('challenge');
      setMessage('Enter the current six-digit code from your authenticator app.');
    } catch (cause) {
      console.error('Unable to start authenticator challenge:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to start authenticator verification.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!factorId || !challengeId || !/^\d{6,8}$/.test(verificationCode.trim())) {
      setError('Enter the current six- to eight-digit authenticator code.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verificationCode.trim(),
      });
      if (verifyError) throw verifyError;

      setFlow(null);
      setQrCode('');
      setSecret('');
      setChallengeId('');
      setVerificationCode('');
      await refreshSecurityState();

      // The sole owner turns enforcement on only after Supabase confirms AAL2.
      // The database independently checks that the owner has a verified factor.
      const response = await fetch('/api/admin/security/mfa-enforcement', {
        method: 'POST',
      });
      if (response.ok) {
        setEnforcementEnabled(true);
        setMessage('Authenticator verified. Administrator MFA enforcement is now enabled.');
      } else {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 403 && !isOwner) {
          setMessage('Authenticator verified. This account is ready to be granted administrator access by the owner.');
        } else {
          setMessage(
            result.error ??
              'Authenticator verified. The owner can enable administrator MFA enforcement from this page.'
          );
        }
      }
      await refreshSecurityState();
    } catch (cause) {
      console.error('Unable to verify authenticator code:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to verify authenticator code.');
    } finally {
      setBusy(false);
    }
  }

  async function enableEnforcement() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/security/mfa-enforcement', {
        method: 'POST',
      });
      const result = (await response.json()) as { error?: string; enabled?: boolean };
      if (!response.ok) throw new Error(result.error ?? 'Unable to enable administrator MFA.');
      setEnforcementEnabled(result.enabled === true);
      setMessage('Administrator MFA enforcement is enabled.');
    } catch (cause) {
      console.error('Unable to enable administrator MFA enforcement:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to enable administrator MFA.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container py-12">
      <div className="mt-8 max-w-3xl">
        <Link href="/account" className="text-accent text-sm font-medium hover:underline">
          Back to account
        </Link>
        <p className="text-accent mt-8 text-sm font-semibold tracking-wider uppercase">
          Account security
        </p>
        <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Authenticator security</h1>
        <p className="text-text-secondary mt-4">
          Set up a time-based authenticator app. Administrator access will require a verified
          authenticator once the owner enables enforcement.
        </p>
      </div>

      <section className="border-border bg-bg-secondary/40 mt-8 max-w-3xl rounded-2xl border p-6">
        <h2 className="text-xl font-bold">Authenticator app (TOTP)</h2>
        {loading ? (
          <p className="text-text-secondary mt-4">Loading security settings…</p>
        ) : (
          <>
            <p className="text-text-secondary mt-3 text-sm">
              Use an authenticator such as 1Password, Microsoft Authenticator, Google Authenticator,
              or Aegis. Keep access to the authenticator secure; do not share its secret or codes.
            </p>

            {enforcementEnabled && (
              <p className="mt-4 rounded-xl border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
                Administrator MFA enforcement is enabled for CathoScroll.
              </p>
            )}

            {verifiedFactors.length > 0 ? (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-semibold">Verified authenticator</p>
                {verifiedFactors.map((factor) => (
                  <div key={factor.id} className="border-border rounded-xl border p-3">
                    <p className="font-medium">{factor.friendly_name || 'Authenticator app'}</p>
                    <p className="text-text-muted mt-1 text-xs">Verified and linked to this account</p>
                  </div>
                ))}
                {assurance?.currentLevel === 'aal2' ? (
                  <p className="text-sm">This session has completed second-factor verification.</p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void beginChallenge(verifiedFactors[0].id)}
                    className="bg-accent mt-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Verify authenticator
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-5">
                <p className="text-text-secondary text-sm">
                  No verified authenticator is linked to this account.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void beginEnrollment()}
                  className="bg-accent mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Preparing…' : 'Set up authenticator'}
                </button>
              </div>
            )}

            {flow === 'enroll' && qrCode && (
              <div className="border-border mt-6 rounded-xl border p-4">
                <p className="font-semibold">1. Scan this QR code</p>
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`}
                  alt="Authenticator setup QR code"
                  className="mt-3 h-52 w-52 rounded-lg bg-white p-2"
                />
                <p className="mt-3 text-sm font-medium">Or enter this setup key manually</p>
                <code className="mt-2 block break-all rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
                  {secret}
                </code>
              </div>
            )}

            {(flow === 'enroll' || flow === 'challenge') && (
              <div className="mt-5 space-y-3">
                <label htmlFor="authenticator-code" className="block text-sm font-semibold">
                  {flow === 'enroll' ? '2. Verify setup code' : 'Authenticator verification code'}
                </label>
                <input
                  id="authenticator-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="border-border bg-background w-full max-w-xs rounded-xl border px-4 py-3"
                  placeholder="000000"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verifyCode()}
                  className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Verifying…' : 'Verify code'}
                </button>
              </div>
            )}

            {isOwner && verifiedFactors.length > 0 && assurance?.currentLevel === 'aal2' && !enforcementEnabled && (
              <div className="border-border mt-6 border-t pt-5">
                <p className="text-sm">
                  Your owner account has a verified authenticator. Enabling enforcement will require
                  every administrator to enrol and verify MFA before receiving or retaining admin access.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void enableEnforcement()}
                  className="bg-accent mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Enabling…' : 'Enable administrator MFA enforcement'}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      </section>
    </main>
  );
}
