import { useEffect, useState } from 'react';
import type { NativeActivity } from './activity';

export function NativeActivityAlert({
  activity,
  version,
  onPresenceChange,
}: {
  activity: NativeActivity;
  version: number;
  onPresenceChange: (present: boolean) => void;
}) {
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onPresenceChange(count > 0 || Boolean(error));
    return () => onPresenceChange(false);
  }, [count, error, onPresenceChange]);

  useEffect(() => {
    let active = true;
    activity.store.unnotifiedRejectionCount(activity.userId).then(
      (value) => {
        if (active) {
          setCount(value);
          setError('');
        }
      },
      (cause: unknown) => {
        console.error('Unable to load saved account notifications:', cause);
        if (active) setError('Account notifications could not be loaded.');
      }
    );
    return () => {
      active = false;
    };
  }, [activity, version, attempt]);

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await activity.store.dismissRejections(activity.userId);
      setAttempt((value) => value + 1);
    } catch (cause) {
      console.error('Unable to dismiss saved account notifications:', cause);
      setError('Account notifications could not be dismissed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!count && !error) return null;
  return (
    <div role="status" className="bg-bg-secondary border-border rounded-xl border p-3 text-sm">
      {count > 0 && (
        <p>
          {count === 1
            ? 'An account change could not be saved'
            : 'Some account changes could not be saved'}{' '}
          because the topic is no longer available. Your other changes will continue to sync.
        </p>
      )}
      {error && <p>{error}</p>}
      {count > 0 ? (
        <button
          type="button"
          className="text-accent underline"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Dismiss
        </button>
      ) : (
        <button
          type="button"
          className="text-accent underline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry
        </button>
      )}
    </div>
  );
}
