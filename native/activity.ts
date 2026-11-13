import {
  bootstrapActivity,
  type ActivityBootstrapTransport,
} from '@/lib/offline/activity-bootstrap';
import { BackgroundActivitySync } from '@/lib/offline/activity-background-sync';
import { OfflineActivitySync, type ActivityReceipt } from '@/lib/offline/activity-sync';
import type {
  OfflineActivityKind,
  OfflineActivityStore,
  PendingActivity,
} from '@/lib/offline/activity-store';

type Transport = ActivityBootstrapTransport & {
  send(operation: PendingActivity): Promise<ActivityReceipt>;
};

export type NativeActivityStatus = {
  userId: string;
  ready: boolean;
  error: string;
};

export class NativeActivity {
  private readonly scheduler: BackgroundActivitySync;
  private readonly writes = new Set<Promise<void>>();
  private disposed = false;
  private signingOut = false;
  private ready = false;
  private error = '';

  constructor(
    readonly userId: string,
    readonly store: OfflineActivityStore,
    transport: Transport,
    private readonly onChange: (status: NativeActivityStatus) => void,
    isOnline: () => boolean
  ) {
    const sync = new OfflineActivitySync(store, (operation) => transport.send(operation));
    this.scheduler = new BackgroundActivitySync(
      sync,
      (user, cursor) => transport.changes(user, cursor),
      isOnline,
      (_user, cause) => {
        console.error('Unable to synchronize account activity:', cause);
        this.error = this.ready
          ? 'Your account changes could not be synchronized. They are saved on this device.'
          : 'Account activity could not be set up. Saved progress remains on this device; check your connection and try again.';
        this.notify();
      },
      () => {
        this.error = '';
        this.notify();
      },
      async (user, signal) => {
        if (!(await store.isBootstrapped(user))) {
          await bootstrapActivity(store, transport, user, crypto.randomUUID(), signal);
        }
        signal.throwIfAborted();
        if (!this.ready) {
          this.ready = true;
          this.notify();
        }
      },
      () => this.notify()
    );
  }

  async start(): Promise<void> {
    const ready = await this.store.isBootstrapped(this.userId);
    if (this.disposed) return;
    this.ready = ready;
    this.notify();
    this.scheduler.setUser(this.userId);
  }

  requestSync(): void {
    if (!this.disposed && !this.signingOut) this.scheduler.requestSync();
  }

  async set(topicId: string, kind: OfflineActivityKind, value: boolean): Promise<void> {
    if (this.disposed || this.signingOut || (!this.ready && kind !== 'progress')) {
      throw new Error('Account activity is not ready.');
    }
    const write = (async () => {
      if (
        kind === 'progress' &&
        value &&
        (await this.store.getActivity(this.userId, topicId, kind))
      ) {
        return;
      }
      await this.store.setActivity(this.userId, topicId, kind, value, crypto.randomUUID());
    })();
    this.writes.add(write);
    try {
      await write;
      if (!this.disposed) {
        this.notify();
        this.requestSync();
      }
    } finally {
      this.writes.delete(write);
    }
  }

  async signOut(signOut: () => Promise<void>): Promise<void> {
    if (this.disposed || this.signingOut) throw new Error('Account activity is unavailable.');
    this.signingOut = true;
    this.scheduler.setUser(null);
    try {
      await Promise.allSettled(this.writes);
      if ((await this.store.pendingCount(this.userId)) > 0) {
        throw new Error('Your saved changes need to sync before you can sign out.');
      }
      await signOut();
    } catch (error) {
      this.signingOut = false;
      if (!this.disposed) this.scheduler.setUser(this.userId);
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scheduler.dispose();
  }

  private notify(): void {
    if (!this.disposed) {
      this.onChange({ userId: this.userId, ready: this.ready, error: this.error });
    }
  }
}
