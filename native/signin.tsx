import { SigninForm } from '@/components/auth/SigninForm';
import { createClient } from './supabase';

export function NativeSignin({
  onSignedIn,
  description = 'Sign in to access your account, bookmarks, learning progress, and saved activity.',
}: {
  onSignedIn: () => void;
  description?: string;
}) {
  return (
    <SigninForm
      onSignedIn={onSignedIn}
      description={description}
      clientFactory={createClient}
    />
  );
}
