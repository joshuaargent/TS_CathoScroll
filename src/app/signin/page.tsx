'use client';

import { useRouter } from 'next/navigation';
import { SigninForm } from '@/components/auth/SigninForm';

export default function SigninPage() {
  const router = useRouter();

  function onSignedIn() {
    const requestedPath = new URLSearchParams(window.location.search).get('next');
    const destination =
      requestedPath?.startsWith('/') &&
      !requestedPath.startsWith('//') &&
      !requestedPath.includes('\\')
        ? requestedPath
        : '/account';
    router.replace(destination);
  }

  return (
    <main>
      <SigninForm onSignedIn={onSignedIn} />
    </main>
  );
}
