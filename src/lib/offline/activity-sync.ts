import type { OfflineActivityStore, PendingActivity, ServerActivity } from './activity-store';

export interface ActivityReceipt {
  status?: 'applied';
  operationId: string;
  userId: string;
  revision: string;
  value: boolean;
  completedAt: string | null;
}

export interface ActivityRejection {
  status: 'rejected';
  operationId: string;
  userId: string;
  reason: 'topic_unavailable';
}

export interface ActivityDeferred {
  status: 'deferred';
  operationId: string;
  userId: string;
  reason: 'rate_limited';
}

export type ActivityResult = ActivityReceipt | ActivityRejection | ActivityDeferred;
export type SendActivity = (
  operation: PendingActivity,
  signal?: AbortSignal
) => Promise<ActivityResult>;
export type SendActivityBatch = (
  operations: PendingActivity[],
  signal?: AbortSignal
) => Promise<ActivityResult[]>;

export interface ActivityPage {
  userId: string;
  changes: ServerActivity[];
  hasMore: boolean;
  resetRequired?: boolean;
}

export class ActivityResetRequired extends Error {
  constructor() {
    super('Account activity needs to be refreshed from the server.');
    this.name = 'ActivityResetRequired';
  }
}

export type FetchActivity = (
  userId: string,
  cursor: string,
  signal?: AbortSignal
) => Promise<ActivityPage>;

export class OfflineActivitySync {
  private running: Promise<number> | null = null;

  constructor(
    private readonly store: OfflineActivityStore,
    private readonly send: SendActivity,
    private readonly sendBatch?: SendActivityBatch
  ) {}

  async push(userId: string, limit = 100, signal?: AbortSignal): Promise<number> {
    if (!userId || userId.trim() !== userId) throw new Error('Invalid user ID.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid offline sync limit.');
    }
    if (this.running) throw new Error('Offline activity sync is already running.');

    const operation = this.pushBatch(userId, limit, signal);
    this.running = operation;
    try {
      return await operation;
    } finally {
      this.running = null;
    }
  }

  async pull(
    userId: string,
    fetch: FetchActivity,
    pageLimit = 10,
    signal?: AbortSignal
  ): Promise<number> {
    if (!userId || userId.trim() !== userId) throw new Error('Invalid user ID.');
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000) {
      throw new Error('Invalid offline sync page limit.');
    }
    if (this.running) throw new Error('Offline activity sync is already running.');

    const operation = this.pullPages(userId, fetch, pageLimit, signal);
    this.running = operation;
    try {
      return await operation;
    } finally {
      this.running = null;
    }
  }

  private async pushBatch(userId: string, limit: number, signal?: AbortSignal): Promise<number> {
    if (!(await this.store.isBootstrapped(userId))) {
      throw new Error('Offline activity must be initialized before syncing.');
    }
    let sent = 0;
    while (sent < limit) {
      signal?.throwIfAborted();
      const operations = await this.store.nextOperations(
        userId,
        this.sendBatch ? Math.min(100, limit - sent) : 1
      );
      if (!operations.length) break;
      signal?.throwIfAborted();
      const receipts = this.sendBatch
        ? await this.sendBatch(operations, signal)
        : [await this.send(operations[0], signal)];
      signal?.throwIfAborted();
      if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > operations.length) {
        throw new Error('The server returned an invalid offline activity batch.');
      }
      for (let index = 0; index < receipts.length; index++) {
        const operation = operations[index];
        const receipt = receipts[index];
        if (
          !receipt ||
          receipt.operationId !== operation.operationId ||
          receipt.userId !== userId
        ) {
          throw new Error('The server returned a mismatched offline activity receipt.');
        }
        if (receipt.status === 'deferred') {
          if (receipt.reason !== 'rate_limited' || index !== receipts.length - 1) {
            throw new Error('The server returned an invalid deferred activity receipt.');
          }
          return sent;
        }
        if (receipt.status === 'rejected') {
          if (receipt.reason !== 'topic_unavailable' || !operation.value) {
            throw new Error('The server returned an invalid offline activity rejection.');
          }
          await this.store.rejectUnavailableTopic(userId, operation.operationId);
        } else {
          if (
            (receipt.status !== undefined && receipt.status !== 'applied') ||
            typeof receipt.value !== 'boolean' ||
            receipt.value !== operation.value
          ) {
            throw new Error('The server returned an invalid offline activity receipt.');
          }
          await this.store.acknowledge(
            userId,
            operation.operationId,
            receipt.revision,
            receipt.value,
            receipt.completedAt
          );
        }
        sent += 1;
      }
      if (receipts.length < operations.length) {
        throw new Error('The server returned an incomplete offline activity batch.');
      }
    }
    return sent;
  }

  private async pullPages(
    userId: string,
    fetch: FetchActivity,
    pageLimit: number,
    signal?: AbortSignal
  ): Promise<number> {
    if (!(await this.store.isBootstrapped(userId))) {
      throw new Error('Offline activity must be initialized before syncing.');
    }
    let received = 0;
    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber++) {
      signal?.throwIfAborted();
      const cursor = await this.store.cursor(userId);
      signal?.throwIfAborted();
      const page = await fetch(userId, cursor, signal);
      signal?.throwIfAborted();
      if (
        !page ||
        page.userId !== userId ||
        !Array.isArray(page.changes) ||
        typeof page.hasMore !== 'boolean' ||
        (page.resetRequired !== undefined && typeof page.resetRequired !== 'boolean') ||
        (page.resetRequired === true && (page.hasMore || page.changes.length !== 0)) ||
        (page.hasMore && page.changes.length === 0)
      ) {
        throw new Error('The server returned an invalid offline activity page.');
      }
      if (page.resetRequired) throw new ActivityResetRequired();
      await this.store.applyChanges(userId, page.changes);
      received += page.changes.length;
      if (!page.hasMore) break;
    }
    return received;
  }
}
