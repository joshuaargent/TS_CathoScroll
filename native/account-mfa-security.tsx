import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from './supabase';
import { siteConfig } from '@/lib/constants';

interface TotpFactor {
  id: string;
  status: 'verified' | 'unverified';
  friendly_name?: string | null;
}

interface EnforcementStatus {
  isOwner: boolean;
  enforcementEnabled: boolean;
}

function hasVerifiedTotpAssurance(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as { aal?: unknown; amr?: unknown };
    return claims.aal === 'aal2' && Array.isArray(claims.amr) && claims.amr.some(
      (entry) => typeof entry === 'object' && entry !== null && 'method' in entry && entry.method === 'totp'
    );
  } catch {
    return false;
  }
}

async function enforcementRequest(method: 'GET' | 'POST') {
  const client = createClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to manage administrator security.');
  const response = await fetch(new URL('/api/admin/security/mfa-enforcement', siteConfig.url), {
    method,
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
    cache: 'no-store',
  });
  const result = await response.json() as EnforcementStatus & { enabled?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Unable to update administrator MFA settings.');
  return result;
}

export function NativeAccountMfaSecurity({ userId }: { userId: string }) {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [status, setStatus] = useState<EnforcementStatus>({ isOwner: false, enforcementEnabled: false });
  const [totpAssurance, setTotpAssurance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [flow, setFlow] = useState<'enroll' | 'challenge' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const verifiedFactors = useMemo(() => factors.filter((factor) => factor.status === 'verified'), [factors]);
  const unverifiedFactors = useMemo(() => factors.filter((factor) => factor.status === 'unverified'), [factors]);

  const refresh = useCallback(async () => {
    const client = createClient();
    const [{ data: userResult, error: userError }, { data: factorResult, error: factorError }, enforcement] = await Promise.all([
      client.auth.getUser(),
      client.auth.mfa.listFactors(),
      enforcementRequest('GET'),
    ]);
    if (userError) throw userError;
    if (factorError) throw factorError;
    if (!userResult.user || userResult.user.id !== userId) throw new Error('Your account changed. Reload Account settings.');
    const { data: sessionResult, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    setFactors((factorResult.totp ?? []) as TotpFactor[]);
    setStatus({ isOwner: enforcement.isOwner === true, enforcementEnabled: enforcement.enforcementEnabled === true });
    setTotpAssurance(hasVerifiedTotpAssurance(sessionResult.session?.access_token));
  }, [userId]);

  useEffect(() => {
    let active = true;
    void refresh().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load authenticator settings.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refresh]);

  async function beginEnrollment() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const client = createClient();
      for (const factor of unverifiedFactors) {
        const { error: removeError } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (removeError) throw removeError;
      }
      const { data, error: enrollError } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'CathoScroll authenticator',
      });
      if (enrollError) throw enrollError;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFlow('enroll');
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: data.id });
      if (challengeError) throw challengeError;
      setChallengeId(challenge.id);
      setMessage('Scan the QR code with an authenticator app, then enter its current six-digit code.');
    } catch (cause) {
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
      const { data, error: challengeError } = await createClient().auth.mfa.challenge({ factorId: selectedFactorId });
      if (challengeError) throw challengeError;
      setFactorId(selectedFactorId);
      setChallengeId(data.id);
      setFlow('challenge');
      setMessage('Enter the current code from your authenticator app.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start authenticator verification.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!/^\\d{6,8}$/.test(code.trim()) || !factorId || !challengeId) {
      setError('Enter the current six- to eight-digit authenticator code.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: verifyError } = await createClient().auth.mfa.verify({
        factorId,
        challengeId,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      setFlow(null);
      setCode('');
      setQrCode('');
      setSecret('');
      setChallengeId('');
      await refresh();
      setMessage('Authenticator verified. Keep your setup key in a password manager or add a backup authenticator.');
    } catch (cause) {
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
      const result = await enforcementRequest('POST');
      setStatus((previous) => ({ ...previous, enforcementEnabled: result.enabled === true }));
      setMessage('Administrator MFA enforcement is enabled.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to enable administrator MFA enforcement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container mt-6 pb-8">
      <div className="border-border bg-bg-card rounded-2xl border p-5 shadow-sm">
        <h2 className="text-xl font-bold">Authenticator security</h2>
        <p className="text-text-secondary mt-2 text-sm">
          Protect your account with a time-based authenticator app. This works independently of your password.
        </p>
        {loading ? (
          <p className="text-text-secondary mt-4 text-sm">Loading authenticator settings…</p>
        ) : (
          <>
            {status.enforcementEnabled && (
              <p className="mt-4 rounded-xl border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
                Administrator MFA enforcement is enabled.
              </p>
            )}
            {verifiedFactors.length > 0 ? (
              <div className="mt-4 space-y-3">
                {verifiedFactors.map((factor) => (
                  <div key={factor.id} className="border-border rounded-xl border p-3">
                    <p className="text-sm font-semibold">{factor.friendly_name || 'Authenticator app'}</p>
                    <p className="text-text-muted mt-1 text-xs">Verified and linked to this account</p>
                    {!totpAssurance && (
                      <button type="button" disabled={busy} onClick={() => void beginChallenge(factor.id)}
                        className="bg-accent mt-3 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        Verify this authenticator
                      </button>
                    )}
                  </div>
                ))}
                {totpAssurance && <p className="text-sm">This session has completed authenticator verification.</p>}
                <button type="button" disabled={busy || !totpAssurance} onClick={() => void beginEnrollment()}
                  className="border-border rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
                  Add a backup authenticator
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-text-secondary text-sm">No verified authenticator is linked to this account.</p>
                <button type="button" disabled={busy} onClick={() => void beginEnrollment()}
                  className="bg-accent mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  Set up authenticator
                </button>
              </div>
            )}
            {flow === 'enroll' && qrCode && (
              <div className="border-border mt-5 rounded-xl border p-4">
                <p className="font-semibold">Scan this QR code</p>
                <img src={qrCode} alt="Authenticator setup QR code" className="mt-3 h-52 w-52 rounded-lg bg-white p-2" />
                <p className="mt-3 text-sm font-semibold">Or enter this setup key manually</p>
                <code className="mt-2 block break-all rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">{secret}</code>
              </div>
            )}
            {(flow === 'enroll' || flow === 'challenge') && (
              <div className="mt-4 space-y-3">
                <label htmlFor="native-authenticator-code" className="block text-sm font-semibold">
                  {flow === 'enroll' ? 'Verify setup code' : 'Authenticator verification code'}
                </label>
                <input id="native-authenticator-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                  value={code} onChange={(event) => setCode(event.target.value.replace(/\\D/g, '').slice(0, 8))}
                  className="border-border bg-background w-full max-w-xs rounded-xl border px-4 py-3" placeholder="000000" />
                <button type="button" disabled={busy} onClick={() => void verifyCode()}
                  className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? 'Verifying…' : 'Verify code'}
                </button>
              </div>
            )}
            {status.isOwner && verifiedFactors.length > 0 && totpAssurance && !status.enforcementEnabled && (
              <div className="border-border mt-5 border-t pt-4">
                <p className="text-sm">
                  Enabling this requires every current administrator to have a verified authenticator. Complete setup on each administrator account first.
                </p>
                <button type="button" disabled={busy} onClick={() => void enableEnforcement()}
                  className="bg-accent mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? 'Enabling…' : 'Enable administrator MFA enforcement'}
                </button>
              </div>
            )}
            {status.enforcementEnabled && !totpAssurance && (
              <p className="text-text-secondary mt-4 text-sm">
                Your next sign-in will ask for an authenticator code before administrator tools can be used.
              </p>
            )}
          </>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      </div>
    </section>
  );
}
