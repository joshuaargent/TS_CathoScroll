import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WifiOff, X } from 'lucide-react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function OfflineDialog({ onDismiss }: { onDismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onDismiss}
      aria-labelledby="offline-title"
      aria-describedby="offline-description"
      className="border-border bg-bg-card text-text-primary fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border p-6 shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="offline-title" className="text-xl font-bold">
          You&apos;re Offline
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close offline message"
          className="text-text-muted hover:bg-bg-secondary hover:text-text-primary shrink-0 rounded-full p-2 transition-colors"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p id="offline-description" className="text-text-secondary mt-2 text-sm leading-relaxed">
        Changes you make will be synced when you go back online.
      </p>
    </dialog>
  );
}

function OfflineButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="You are offline"
        className="bg-bg-card border-border text-text-primary hover:bg-bg-secondary fixed right-6 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[60] flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition-colors"
      >
        <WifiOff className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && <OfflineDialog onDismiss={() => setOpen(false)} />}
    </>
  );
}

export function OfflineIndicator() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
  return online ? null : <OfflineButton />;
}
