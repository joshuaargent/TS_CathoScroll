export async function withNetworkTimeout<T>(
  signal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Network request timed out.')), 30000);
  try {
    const result = await request(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
