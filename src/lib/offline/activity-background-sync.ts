import type { OfflineActivitySync, FetchActivity } from './activity-sync';

const RETRY_DELAY_MS = 30_000;
const POLL_DELAY_MS = 60_000;
const MAX_OPERATIONS = 100;
const MAX_PAGES = 10;

export class BackgroundActivitySync {
  private userId: string | null = null;
  private generation = 0;
  private running = false;
  private requested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private disposed = false;

  constructor(
    private readonly sync: OfflineActivitySync,
    private readonly fetch: FetchActivity,
    private readonly isOnline: () => boolean,
    private readonly onError: (userId: string, error: unknown) => void,
    private readonly onRecovery: (userId: string) => void
  ) {}

  setUser(userId: string | null): void {
    if (userId !== null && (!userId || userId.trim() !== userId)) {
      throw new Error('Invalid user ID.');
    }
    if (this.disposed) throw new Error('Background sync has been disposed.');
    if (this.userId === userId) return;
    this.userId = userId;
    this.generation++;
    this.failed = false;
    this.requested = Boolean(userId);
    this.schedule(0);
  }

  requestSync(): void {
    if (this.disposed) throw new Error('Background sync has been disposed.');
    this.requested = true;
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    this.userId = null;
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || !this.userId || !this.isOnline() || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    const userId = this.userId;
    if (this.disposed || !userId || !this.isOnline() || this.running) return;
    const generation = this.generation;
    this.running = true;
    this.requested = false;
    let retry = false;
    const isCurrent = () => !this.disposed && this.generation === generation && this.isOnline();

    try {
      let sent = 0;
      while (sent < MAX_OPERATIONS && isCurrent()) {
        const count = await this.sync.push(userId, 1);
        if (!count) break;
        sent += count;
      }
      if (sent === MAX_OPERATIONS) this.requested = true;

      let pages = 0;
      while (pages < MAX_PAGES && isCurrent()) {
        const count = await this.sync.pull(userId, this.fetch, 1);
        if (!count) break;
        pages++;
      }
      if (pages === MAX_PAGES) this.requested = true;
      if (isCurrent() && this.failed) {
        this.failed = false;
        this.onRecovery(userId);
      }
    } catch (error) {
      if (isCurrent()) {
        this.failed = true;
        retry = true;
        this.onError(userId, error);
      }
    } finally {
      this.running = false;
      if (this.generation !== generation || this.requested) {
        this.schedule(0);
      } else if (retry) {
        this.schedule(RETRY_DELAY_MS);
      } else if (isCurrent()) {
        this.schedule(POLL_DELAY_MS);
      }
    }
  }
}
