import type { NotificationTransport } from '@/components/notifications/NotificationList';
import type { NotificationCache } from './notification-cache';
import type { notificationTransport } from './notification-operations';

type Remote = ReturnType<typeof notificationTransport>;

export class NativeNotificationService implements NotificationTransport {
  private syncing: Promise<void> | null = null;

  constructor(
    readonly userId: string,
    private readonly cache: NotificationCache,
    private readonly remote: Remote
  ) {}

  async sync(): Promise<void> {
    if (!navigator.onLine) return;
    if (!this.syncing) {
      this.syncing = this.drain().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const operation = await this.cache.next(this.userId);
      if (!operation) return;
      await this.remote.syncRead(operation.cutoff, operation.all);
      await this.cache.acknowledge(this.userId, operation.sequence);
    }
  }

  async load() {
    if (!navigator.onLine) {
      const cached = await this.cache.load(this.userId);
      if (!cached) throw new Error('Notifications have not yet been saved on this device.');
      return cached;
    }
    const version = await this.cache.version(this.userId);
    await this.sync();
    return this.cache.saveIfClean(this.userId, await this.remote.load(), version);
  }

  async unreadCount(): Promise<number> {
    return (await this.load()).unreadCount;
  }

  async markAsRead(id: number | 'all'): Promise<void> {
    await this.cache.mark(this.userId, id);
    if (navigator.onLine) {
      void this.sync().catch((error: unknown) => {
        console.error('Unable to synchronize notification changes:', error);
      });
    }
  }

  async ensureNoPending(): Promise<void> {
    if (await this.cache.next(this.userId)) {
      throw new Error('Your saved changes need to sync before you can sign out.');
    }
  }
}
