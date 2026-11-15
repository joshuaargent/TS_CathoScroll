export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: 'Invalid JSON body' | 'Request body too large' };

/**
 * Reads JSON with a hard byte limit. Content-Length is an early rejection
 * optimisation only; the stream is independently counted because the header
 * can be missing or inaccurate.
 */
export async function readBoundedJson(
  request: Request,
  maximumBytes: number
): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError('The JSON body limit must be a positive safe integer.');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return { ok: false, status: 400, error: 'Invalid JSON body' };
    }
    if (!Number.isSafeInteger(Number(declaredLength))) {
      return { ok: false, status: 413, error: 'Request body too large' };
    }
    if (Number(declaredLength) > maximumBytes) {
      return { ok: false, status: 413, error: 'Request body too large' };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The request is already being rejected; cancellation is best effort.
        }
        return { ok: false, status: 413, error: 'Request body too large' };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  } finally {
    reader.releaseLock();
  }
}
