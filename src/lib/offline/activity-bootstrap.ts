import type { OfflineActivityStore, SnapshotActivity } from './activity-store';
import type { ActivityPage } from './activity-sync';

export interface ActivityHead {
  userId: string;
  revision: string;
}

export interface ActivitySnapshotPage {
  userId: string;
  items: SnapshotActivity[];
  nextCursor: string | null;
}

export interface ActivityBootstrapTransport {
  head(userId: string, signal?: AbortSignal): Promise<ActivityHead>;
  snapshot(
    userId: string,
    cursor: string | null,
    signal?: AbortSignal
  ): Promise<ActivitySnapshotPage>;
  changes(userId: string, cursor: string, signal?: AbortSignal): Promise<ActivityPage>;
}

function readRevision(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Invalid offline activity revision.');
  }
  return BigInt(value);
}

function checkHead(head: ActivityHead, userId: string): bigint {
  if (!head || head.userId !== userId) throw new Error('Invalid offline activity head.');
  return readRevision(head.revision);
}

export async function bootstrapActivity(
  store: OfflineActivityStore,
  transport: ActivityBootstrapTransport,
  userId: string,
  snapshotId: string,
  signal?: AbortSignal
): Promise<void> {
  if (!userId || userId.trim() !== userId || !snapshotId || snapshotId.trim() !== snapshotId) {
    throw new Error('Invalid offline activity bootstrap identity.');
  }
  signal?.throwIfAborted();
  if (await store.isBootstrapped(userId)) {
    throw new Error('Offline activity has already been initialized.');
  }
  signal?.throwIfAborted();
  const head = await transport.head(userId, signal);
  const start = checkHead(head, userId);
  signal?.throwIfAborted();
  await store.beginBootstrap(userId, snapshotId, start.toString());

  let cursor: string | null = null;
  const seen = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    const page = await transport.snapshot(userId, cursor, signal);
    signal?.throwIfAborted();
    if (
      !page ||
      page.userId !== userId ||
      !Array.isArray(page.items) ||
      page.items.length > 500 ||
      (page.nextCursor !== null &&
        (typeof page.nextCursor !== 'string' ||
          !page.nextCursor ||
          page.nextCursor.length > 4096 ||
          seen.has(page.nextCursor) ||
          page.items.length === 0))
    ) {
      throw new Error('Invalid offline activity snapshot page.');
    }
    await store.stageBootstrap(userId, snapshotId, page.items);
    if (page.nextCursor === null) break;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  signal?.throwIfAborted();
  const barrier = checkHead(await transport.head(userId, signal), userId);
  if (barrier < start) throw new Error('Offline activity revision went backwards.');
  let applied = start;
  while (applied < barrier) {
    signal?.throwIfAborted();
    const page = await transport.changes(userId, applied.toString(), signal);
    signal?.throwIfAborted();
    if (
      !page ||
      page.userId !== userId ||
      !Array.isArray(page.changes) ||
      page.changes.length === 0 ||
      page.changes.length > 500 ||
      typeof page.hasMore !== 'boolean'
    ) {
      throw new Error('Invalid offline activity changes page.');
    }
    await store.applyBootstrapChanges(userId, snapshotId, page.changes);
    applied = readRevision(page.changes[page.changes.length - 1].revision);
    if (!page.hasMore && applied < barrier) {
      throw new Error('Offline activity changes ended before the snapshot was reconciled.');
    }
  }
  signal?.throwIfAborted();
  await store.completeBootstrap(userId, snapshotId);
}
