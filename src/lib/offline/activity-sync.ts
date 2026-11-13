import type { OfflineActivityStore, PendingActivity } from './activity-store';

export interface ActivityReceipt {
  operationId: string;
  userId: string;
}

export type SendActivity = (operation: PendingActivity) => Promise<ActivityReceipt>;

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

  private async pushBatch(userId: string, limit: number): Promise<number> {
    let sent = 0;
    while (sent < limit) {
      const operation = await this.store.nextOperation(userId);
      if (!operation) break;

      const receipt = await this.send(operation);
      if (receipt.operationId !== operation.operationId || receipt.userId !== userId) {
        throw new Error('The server returned a mismatched offline activity receipt.');
      }

      await this.store.acknowledge(userId, operation.operationId);
      sent += 1;
    }
    return sent;
  }
}
