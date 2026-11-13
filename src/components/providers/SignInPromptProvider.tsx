'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';

type SignInPrompt = { action: string; returnTo: string };
const SignInPromptContext = createContext<((action: string) => void) | null>(null);

function SignInDialog({ prompt, onDismiss }: { prompt: SignInPrompt; onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onDismiss}
      aria-labelledby="sign-in-prompt-title"
      aria-describedby="sign-in-prompt-description"
      className="border-border bg-bg-card text-text-primary fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border p-6 shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="sign-in-prompt-title" className="text-xl font-bold">
          Sign in to continue
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close sign-in prompt"
          className="text-text-muted hover:bg-bg-secondary hover:text-text-primary shrink-0 rounded-full p-2 transition-colors"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p
        id="sign-in-prompt-description"
        className="text-text-secondary mt-2 text-sm leading-relaxed"
      >
        Sign in to {prompt.action} and keep your activity linked to your account.
      </p>
      <Button asChild className="mt-6 w-full">
        <Link
          href={`/signin?next=${encodeURIComponent(prompt.returnTo)}`}
          onClick={onDismiss}
          style={{ color: 'var(--color-bg-primary)' }}
        >
          Sign in
        </Link>
      </Button>
    </dialog>
  );
}

export function SignInPromptProvider({ children }: { children: React.ReactNode }) {
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null);

  function requestSignIn(action: string) {
    setPrompt({
      action,
      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
  }

  return (
    <SignInPromptContext.Provider value={requestSignIn}>
      {children}
      {prompt && <SignInDialog prompt={prompt} onDismiss={() => setPrompt(null)} />}
    </SignInPromptContext.Provider>
  );
}

export function useSignInPrompt() {
  const requestSignIn = useContext(SignInPromptContext);
  if (!requestSignIn) throw new Error('useSignInPrompt must be used within SignInPromptProvider');
  return requestSignIn;
}
