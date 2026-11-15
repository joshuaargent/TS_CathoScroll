import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleAlert, WifiOff, X } from 'lucide-react';
import type { NativeActivity } from './activity';
import { NativeActivityAlert } from './activity-alert';

export type NativeStatusNotice = {
  id: string;
  message: string;
  action?: { label: string; onClick: () => void };
};

const nativeNoticeQueue: NativeStatusNotice[] = [];

type NativeStatusNoticeEvent = {
  notice: NativeStatusNotice;
};

export function notifyNativeStatus(
  message: string,
  options: { id?: string; action?: NativeStatusNotice['action'] } = {}
) {
  const notice: NativeStatusNotice = {
    id: options.id ?? message,
    message,
    ...(options.action ? { action: options.action } : {}),
  };
  const existing = nativeNoticeQueue.findIndex((item) => item.id === notice.id);
  if (existing >= 0) nativeNoticeQueue.splice(existing, 1);
  nativeNoticeQueue.push(notice);
  if (nativeNoticeQueue.length > 8) nativeNoticeQueue.shift();
  window.dispatchEvent(new CustomEvent<NativeStatusNoticeEvent>('cathoscroll:status-notice', {
    detail: { notice },
  }));
}

export function clearNativeStatusNotice(id: string) {
  const index = nativeNoticeQueue.findIndex((notice) => notice.id === id);
  if (index >= 0) nativeNoticeQueue.splice(index, 1);
  window.dispatchEvent(new CustomEvent('cathoscroll:clear-status-notice', { detail: id }));
}

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function OfflineIndicator({
  activity,
  activityVersion,
}: {
  activity: NativeActivity | null;
  activityVersion: number;
}) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<NativeStatusNotice[]>(() => [...nativeNoticeQueue]);
  const [activityWarning, setActivityWarning] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<NativeStatusNoticeEvent>).detail;
      if (!detail?.notice?.id || !detail.notice.message) return;
      setNotices((previous) => {
        const next = previous.filter((notice) => notice.id !== detail.notice.id);
        return [...next, detail.notice].slice(-8);
      });
    };
    const clear = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string') setNotices((previous) => previous.filter((notice) => notice.id !== id));
    };
    window.addEventListener('cathoscroll:status-notice', receive);
    window.addEventListener('cathoscroll:clear-status-notice', clear);
    return () => {
      window.removeEventListener('cathoscroll:status-notice', receive);
      window.removeEventListener('cathoscroll:clear-status-notice', clear);
    };
  }, []);

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
  }, [open]);

  const hasWarnings = notices.length > 0 || activityWarning;

  return (
    <>
      {(!online || hasWarnings) && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={hasWarnings ? 'App status needs attention' : 'You are offline'}
          aria-haspopup="dialog"
          className="bg-bg-card border-border text-text-primary hover:bg-bg-secondary fixed right-6 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[60] flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition-colors"
        >
          {hasWarnings ? (
            <CircleAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />
          ) : (
            <WifiOff className="h-5 w-5" aria-hidden="true" />
          )}
          {!online && hasWarnings && (
            <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-600" />
          )}
        </button>
      )}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="native-status-title"
        className="border-border bg-bg-card text-text-primary fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop:bg-black/50"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="native-status-title" className="text-xl font-bold">
            {online ? 'App Status' : "You're Offline"}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close app status"
            className="text-text-muted hover:bg-bg-secondary hover:text-text-primary shrink-0 rounded-full p-2 transition-colors"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {!online && (
          <p className="text-text-secondary mt-2 text-sm leading-relaxed">
            Some saved activity will sync when you reconnect. Account and security changes require an internet connection.
          </p>
        )}
        {notices.length > 0 && (
          <div className="mt-4 space-y-3" role="status" aria-live="polite">
            {notices.map((notice) => (
              <div key={notice.id} className="bg-bg-secondary rounded-xl p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1">{notice.message}</p>
                  <button
                    type="button"
                    aria-label="Dismiss status message"
                    onClick={() => clearNativeStatusNotice(notice.id)}
                    className="text-text-muted hover:text-text-primary shrink-0"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {notice.action && (
                  <button
                    type="button"
                    className="text-accent mt-2 underline"
                    onClick={notice.action.onClick}
                  >
                    {notice.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {activity && (
          <div className="mt-4">
            <NativeActivityAlert
              key={activity.userId}
              activity={activity}
              version={activityVersion}
              onPresenceChange={setActivityWarning}
            />
          </div>
        )}
        {online && !hasWarnings && (
          <p className="text-text-secondary mt-3 text-sm">No app issues need your attention.</p>
        )}
      </dialog>
    </>
  );
}
