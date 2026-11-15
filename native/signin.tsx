import { useEffect, useState } from 'react';
import { SigninForm } from '@/components/auth/SigninForm';
import { createClient } from './supabase';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

export function NativeSignin({
  onSignedIn,
  description = 'Sign in to access your account, bookmarks, learning progress, and saved activity.',
}: {
  onSignedIn: () => void;
  description?: string;
}) {
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

  useEffect(() => {
    if (!online) {
      notifyNativeStatus('Connect to the internet to sign in.', { id: 'signin-offline' });
    } else {
      clearNativeStatusNotice('signin-offline');
    }
    return () => clearNativeStatusNotice('signin-offline');
  }, [online]);

  return (
    <SigninForm
      onSignedIn={onSignedIn}
      description={description}
      clientFactory={createClient}
      online={online}
    />
  );
}
