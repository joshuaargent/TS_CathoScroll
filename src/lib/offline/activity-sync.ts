import type { OfflineActivityStore, PendingActivity, ServerActivity } from './activity-store';

export interface ActivityReceipt {
  operationId: string;
  userId: string;
  revision: string;
  value: boolean;
}

export type SendActivity = (operation: PendingActivity) => Promise<ActivityReceipt>;

export interface ActivityPage {
  userId: string;
  changes: ServerActivity[];
  hasMore: boolean;
}

export type FetchActivity = (userId: string, cursor: string) => Promise<ActivityPage>;

export class OfflineActivitySync {
  private running: Promise<number> | null = null;

  constructor(
    private readonly store: OfflineActivityStore,
    private readonly send: SendActivity
  ) {}

  async push(userId: string, limit = 100): Promise<number> {
    if (!userId || userId.trim() !== userId) throw new Error('Invalid user ID.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid offline sync limit.');
    }
    if (this.running) throw new Error('Offline activity sync is already running.');

    const operation = this.pushBatch(userId, limit);
    this.running = operation;
    try {
      return await operation;
    } finally {
      this.running = null;
    }
  }

  async pull(userId: string, fetch: FetchActivity, pageLimit = 10): Promise<number> {
    if (!userId || userId.trim() !== userId) throw new Error('Invalid user ID.');
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000) {
      throw new Error('Invalid offline sync page limit.');
    }
    if (this.running) throw new Error('Offline activity sync is already running.');

    const operation = this.pullPages(userId, fetch, pageLimit);
    this.running = operation;
    try {
      return await operation;
    } finally {
      this.running = null;
    }
  }

  private async pushBatch(userId: string, limit: number): Promise<number> {
    if (!(await this.store.isBootstrapped(userId))) {
      throw new Error('Offline activity must be initialized before syncing.');
    }
    let sent = 0;
    while (sent < limit) {
      const operation = await this.store.nextOperation(userId);
      if (!operation) break;

      const receipt = await this.send(operation);
      if (receipt.operationId !== operation.operationId || receipt.userId !== userId) {
        throw new Error('The server returned a mismatched offline activity receipt.');
      }

      await this.store.acknowledge(userId, operation.operationId, receipt.revision, receipt.value);
      sent += 1;
    }
    return sent;
  }

  private async pullPages(
    userId: string,
    fetch: FetchActivity,
    pageLimit: number
  ): Promise<number> {
    if (!(await this.store.isBootstrapped(userId))) {
      throw new Error('Offline activity must be initialized before syncing.');
    }
    let received = 0;
    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber++) {
      const cursor = await this.store.cursor(userId);
      const page = await fetch(userId, cursor);
      if (
        page.userId !== userId ||
        !Array.isArray(page.changes) ||
        typeof page.hasMore !== 'boolean' ||
        (page.hasMore && page.changes.length === 0)
      ) {
        throw new Error('The server returned an invalid offline activity page.');
      }
      await this.store.applyChanges(userId, page.changes);
      received += page.changes.length;
      if (!page.hasMore) break;
    }
    return received;
  }
}
