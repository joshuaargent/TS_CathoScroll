import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function SignupFormView({
  loading,
  error,
  online = true,
  confirmation = false,
  showPassword,
  showConfirmPassword,
  onTogglePassword,
  onToggleConfirmPassword,
  onSubmit,
}: {
  loading: boolean;
  error: string;
  online?: boolean;
  confirmation?: boolean;
  showPassword: boolean;
  showConfirmPassword: boolean;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [personalizationConsent, setPersonalizationConsent] = useState(false);
  const [serviceImprovementConsent, setServiceImprovementConsent] = useState(false);
  const [sponsorMeasurementConsent, setSponsorMeasurementConsent] = useState(false);

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
        <div className="mx-auto">
          <form onSubmit={onSubmit} className="space-y-6">
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
              disabled={loading || !online}
              required
            />

            <Input
              label="Email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              disabled={loading || !online}
              required
            />

            <div className="relative">
              <Input
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a password"
                autoComplete="new-password"
                hint="Minimum 12 characters."
                disabled={loading || !online}
                required
              />
              <button
                type="button"
                onClick={onTogglePassword}
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
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm your password"
                autoComplete="new-password"
                disabled={loading || !online}
                required
              />
              <button
                type="button"
                onClick={onToggleConfirmPassword}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                className="text-text-muted hover:text-text-primary absolute top-[38px] right-3"
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <div className="border-border bg-bg-secondary/40 space-y-4 rounded-xl border p-4">
              <label htmlFor="signup-personalization-consent" className="flex cursor-pointer items-start gap-2.5">
                <input
                  id="signup-personalization-consent"
                  name="personalizationConsent"
                  type="checkbox"
                  value="true"
                  checked={personalizationConsent}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setPersonalizationConsent(enabled);
                    if (enabled) setServiceImprovementConsent(true);
                  }}
                  disabled={loading || !online}
                  className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-text-secondary text-xs leading-relaxed">
                  <span className="text-text-primary font-semibold">Personalised recommendations — I explicitly consent</span>
                  {' '}to using my account actions and chosen interests to build a private recommendation profile. This may reveal religious or philosophical beliefs. Selecting Personalisation also enables Service improvement analytics, which remains enabled while Personalisation is active. Turn off Personalisation before withdrawing Service improvement. It is optional and can be withdrawn in Account settings.
                </span>
              </label>

              <label htmlFor="signup-service-analytics-consent" className="flex cursor-pointer items-start gap-2.5">
                <input
                  id="signup-service-analytics-consent"
                  name="serviceImprovementConsent"
                  type="checkbox"
                  value="true"
                  checked={serviceImprovementConsent}
                  onChange={(event) => setServiceImprovementConsent(event.target.checked)}
                  disabled={loading || !online || personalizationConsent}
                  className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-text-secondary text-xs leading-relaxed">
                  <span className="text-text-primary font-semibold">Service improvement analytics — I explicitly consent</span>
                  {' '}— optional account-linked measurement of signed-in topic/comment engagement and site performance. Aggregated results may inform shared topic ordering for all readers, without profiling you individually. Activity may reveal religious or philosophical interests. This choice must remain enabled while Personalisation is active. Reading signals inform recommendations only while Personalisation is enabled too.
                </span>
              </label>

              <label htmlFor="signup-sponsor-measurement-consent" className="flex cursor-pointer items-start gap-2.5">
                <input
                  id="signup-sponsor-measurement-consent"
                  name="sponsorMeasurementConsent"
                  type="checkbox"
                  value="true"
                  checked={sponsorMeasurementConsent}
                  onChange={(event) => setSponsorMeasurementConsent(event.target.checked)}
                  disabled={loading || !online}
                  className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-text-secondary text-xs leading-relaxed">
                  <span className="text-text-primary font-semibold">Sponsor measurement — I explicitly consent</span>
                  {' '}— optional account-linked viewability, click and frequency measurement. Placement context may reveal religious or philosophical interests. Sponsor placements still appear if this is off.
                </span>
              </label>

              <p className="text-text-muted text-xs leading-relaxed">
                All choices are optional and can be changed later. Personalisation requires Service improvement analytics; turn off Personalisation before withdrawing Service improvement. Sponsor measurement remains separate. See the{' '}
                <Link href="/privacy" className="text-accent font-medium underline">Privacy Policy</Link>.
              </p>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
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
      )}
    </div>
  );
}
