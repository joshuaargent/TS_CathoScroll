export type FeedRefreshTask = () => Promise<boolean>;

export interface FeedRefreshCoordinator {
  request(): Promise<void>;
  reconnect(): Promise<void>;
  dispose(): void;
}

/**
 * Coalesces overlapping refreshes and rate-limits ordinary foreground refreshes.
 * A reconnect during an in-flight failed request schedules exactly one immediate retry.
 */
export function createFeedRefreshCoordinator(
  task: FeedRefreshTask,
  cooldownMs = 30_000,
  now: () => number = Date.now
): FeedRefreshCoordinator {
  let inFlight: Promise<boolean> | null = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let retryAfterInFlight = false;
  let disposed = false;

  const run = (force: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();

    if (inFlight) {
      if (force) retryAfterInFlight = true;
      return inFlight.then(() => undefined);
    }

    if (!force && now() - lastAttemptAt < cooldownMs) {
      return Promise.resolve();
    }

    lastAttemptAt = now();
    const request = (async () => {
      try {
        return await task();
      } catch {
        return false;
      }
    })();

    inFlight = request;
    void request.then((succeeded) => {
      if (inFlight === request) inFlight = null;
      if (!retryAfterInFlight) return;

      retryAfterInFlight = false;
      if (!succeeded && !disposed) {
        lastAttemptAt = Number.NEGATIVE_INFINITY;
        void run(true);
      }
    });

    return request.then(() => undefined);
  };

  return {
    request: () => run(false),
    reconnect: () => run(true),
    dispose: () => {
      disposed = true;
      retryAfterInFlight = false;
    },
  };
}
