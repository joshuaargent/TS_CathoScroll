import type { FormEvent } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';

export type AccountPageViewProps = {
  loading?: boolean;
  displayName: string;
  username: string;
  bio: string;
  email: string;
  newPassword: string;
  confirmPassword: string;
  membershipLabel: string;
  saving: boolean;
  signingOut: boolean;
  saveDisabled: boolean;
  accountSettingsDisabled: boolean;
  signOutDisabled: boolean;
  statusMessage?: string;
  error?: string;
  message?: string;
  signOutError?: string;
  onDisplayNameChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
};

export function AccountPageSkeleton() {
  return (
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <Skeleton className="h-16 w-64" />
        <Skeleton className="mt-4 h-6 w-96" />
      </div>
      <div className="space-y-10">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-3 h-5 w-72" />
          </div>
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="h-24 w-full" />
        <div className="flex gap-4">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-12 w-32" />
        </div>
      </div>
    </main>
  );
}

/**
 * Shared account presentation for the website and installed apps.
 * Platform-specific auth, persistence, validation, and offline policy stay in their adapters.
 */
export function AccountPageView(props: AccountPageViewProps) {
  if (props.loading) return <AccountPageSkeleton />;

  return (
    <main className="container py-12">
      <div className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Account</h1>
        <p className="text-text-secondary mt-4 text-lg">
          Manage your public profile, account details, and password.
        </p>
      </div>

      <form onSubmit={props.onSave} className="space-y-10">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Public Profile</h2>
              <p className="text-text-secondary mt-2">
                This is how people will see you on CathoScroll.
              </p>
            </div>
            {props.username.trim() && (
              <Link href={`/profile/${encodeURIComponent(props.username.trim())}`}>
                <Button size="sm" style={{ color: '#ffffff' }}>
                  View Public Profile
                </Button>
              </Link>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <Input
            label="Display Name"
            value={props.displayName}
            disabled={props.saving}
            onChange={(event) => props.onDisplayNameChange(event.target.value)}
          />
          <Input
            label="Username"
            value={props.username}
            disabled={props.saving}
            onChange={(event) => props.onUsernameChange(event.target.value)}
            hint="3-20 characters. Used for your public profile URL."
          />
          <div className="space-y-1.5">
            <label className="text-text-primary text-sm font-medium" htmlFor="account-bio">Bio</label>
            <textarea
              id="account-bio"
              value={props.bio}
              maxLength={250}
              disabled={props.saving}
              onChange={(event) => props.onBioChange(event.target.value)}
              rows={5}
              className="border-border bg-bg-card w-full rounded-lg border p-4"
              placeholder="Tell people a little about yourself..."
            />
            <p className="text-text-muted text-sm">{props.bio.length}/250</p>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Account Settings</h2>
          <Input
            label="Email Address"
            type="email"
            value={props.email}
            disabled={props.accountSettingsDisabled || props.saving}
            onChange={(event) => props.onEmailChange(event.target.value)}
          />
          <Input
            label="New Password"
            type="password"
            value={props.newPassword}
            disabled={props.accountSettingsDisabled || props.saving}
            onChange={(event) => props.onNewPasswordChange(event.target.value)}
            hint="Minimum 8 characters. Leave blank to keep your current password."
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={props.confirmPassword}
            disabled={props.accountSettingsDisabled || props.saving}
            onChange={(event) => props.onConfirmPasswordChange(event.target.value)}
            hint="Required when changing your password."
          />
        </section>

        <section>
          <div className="border-border rounded-xl border p-6">
            <p className="text-text-muted text-sm">Membership</p>
            <p className="mt-2 text-lg font-medium capitalize">{props.membershipLabel}</p>
          </div>
        </section>

        {props.statusMessage && (
          <p role="status" className="text-text-secondary text-sm">{props.statusMessage}</p>
        )}
        {props.error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
            {props.error}
          </div>
        )}
        {props.message && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-600">
            {props.message}
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <Button type="submit" disabled={props.saveDisabled || props.saving} size="lg" style={{ color: '#ffffff' }}>
            {props.saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
          <Button type="button" variant="secondary" size="lg" disabled={props.signOutDisabled || props.signingOut} onClick={props.onSignOut}>
            {props.signingOut ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing Out...
              </>
            ) : (
              'Sign Out'
            )}
          </Button>
        </div>
        {props.signOutError && <p role="alert" className="text-sm text-red-600">{props.signOutError}</p>}
      </form>
    </main>
  );
}
