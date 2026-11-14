import type { OfflineDatabase, OfflineTransaction } from '@/lib/offline/activity-store';
import type { Notification } from '@/components/notifications/NotificationList';

export type NotificationSnapshot = { notifications: Notification[]; unreadCount: number };
export type PendingNotification = { sequence: number; cutoff: number; all: boolean };

function snapshot(value: string): NotificationSnapshot {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid saved notifications.');
  const data = parsed as Record<string, unknown>;
  if (
    !Array.isArray(data.notifications) ||
    data.notifications.length > 50 ||
    !Number.isSafeInteger(data.unreadCount) ||
    Number(data.unreadCount) < 0
  ) {
    throw new Error('Invalid saved notifications.');
  }
  for (const item of data.notifications) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      typeof item.type !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.body !== 'string' ||
      (item.topic_id !== null && typeof item.topic_id !== 'string') ||
      (item.topic_slug !== null && typeof item.topic_slug !== 'string') ||
      (item.comment_id !== null && !Number.isSafeInteger(item.comment_id)) ||
      (item.read_at !== null && typeof item.read_at !== 'string') ||
      typeof item.created_at !== 'string'
    ) {
      throw new Error('Invalid saved notification.');
    }
  }
  return parsed as NotificationSnapshot;
}

export class NotificationCache {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS offline_notifications (
        user_id TEXT PRIMARY KEY NOT NULL,
        snapshot TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS offline_notification_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        cutoff INTEGER NOT NULL,
        all_read INTEGER NOT NULL CHECK (all_read IN (0, 1))
      )`);
    });
  }

  private async read(db: OfflineTransaction, userId: string): Promise<NotificationSnapshot | null> {
    const rows = await db.query('SELECT snapshot FROM offline_notifications WHERE user_id = ?', [
      userId,
    ]);
    if (!rows.length) return null;
    if (rows.length !== 1 || typeof rows[0].snapshot !== 'string') {
      throw new Error('Invalid saved notifications.');
    }
    return snapshot(rows[0].snapshot);
  }

  load(userId: string): Promise<NotificationSnapshot | null> {
    return this.database.transaction((db) => this.read(db, userId));
  }

  async version(userId: string): Promise<number | null> {
    return this.database.transaction(async (db) => {
      const rows = await db.query('SELECT revision FROM offline_notifications WHERE user_id = ?', [
        userId,
      ]);
      if (!rows.length) return null;
      if (rows.length !== 1 || !Number.isSafeInteger(rows[0].revision)) {
        throw new Error('Invalid saved notification revision.');
      }
      return Number(rows[0].revision);
    });
  }

  async saveIfClean(
    userId: string,
    value: NotificationSnapshot,
    expectedVersion: number | null
  ): Promise<NotificationSnapshot> {
    const valid = snapshot(JSON.stringify(value));
    return this.database.transaction(async (db) => {
      const pending = await db.query(
        'SELECT sequence FROM offline_notification_outbox WHERE user_id = ? LIMIT 1',
        [userId]
      );
      const versions = await db.query(
        'SELECT revision FROM offline_notifications WHERE user_id = ?',
        [userId]
      );
      if (pending.length || (versions.length ? versions[0].revision : null) !== expectedVersion) {
        const current = await this.read(db, userId);
        if (!current) throw new Error('Saved notifications are unavailable.');
        return current;
      }
      await db.execute(
        'INSERT OR REPLACE INTO offline_notifications (user_id, snapshot, revision) VALUES (?, ?, ?)',
        [userId, JSON.stringify(valid), (expectedVersion ?? -1) + 1]
      );
      return valid;
    });
  }

  async mark(userId: string, id: number | 'all'): Promise<void> {
    await this.database.transaction(async (db) => {
      const current = await this.read(db, userId);
      if (!current) throw new Error('Saved notifications are unavailable.');
      const target = id === 'all' ? Math.max(0, ...current.notifications.map((row) => row.id)) : id;
      if (!Number.isSafeInteger(target) || target < 1) throw new Error('Invalid notification.');
      const targetRow = current.notifications.find((row) => row.id === target);
      if (id !== 'all' && !targetRow) throw new Error('Notification not found.');
      const readAt = new Date().toISOString();
      const next = {
        notifications: current.notifications.map((row) =>
          (id === 'all' ? row.id <= target : row.id === target) && !row.read_at
            ? { ...row, read_at: readAt }
            : row
        ),
        unreadCount:
          id === 'all' ? 0 : Math.max(0, current.unreadCount - (targetRow?.read_at ? 0 : 1)),
      };
      await db.execute(
        'UPDATE offline_notifications SET snapshot = ?, revision = revision + 1 WHERE user_id = ?',
        [JSON.stringify(next), userId]
      );
      await db.execute(
        'INSERT INTO offline_notification_outbox (user_id, cutoff, all_read) VALUES (?, ?, ?)',
        [userId, target, id === 'all' ? 1 : 0]
      );
    });
  }

  async next(userId: string): Promise<PendingNotification | null> {
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT sequence, cutoff, all_read FROM offline_notification_outbox WHERE user_id = ? ORDER BY sequence LIMIT 1',
        [userId]
      );
      if (!rows.length) return null;
      const row = rows[0];
      if (
        !Number.isSafeInteger(row.sequence) ||
        !Number.isSafeInteger(row.cutoff) ||
        (row.all_read !== 0 && row.all_read !== 1)
      ) {
        throw new Error('Invalid saved notification change.');
      }
      return {
        sequence: Number(row.sequence),
        cutoff: Number(row.cutoff),
        all: row.all_read === 1,
      };
    });
  }

  async acknowledge(userId: string, sequence: number): Promise<void> {
    await this.database.transaction((db) =>
      db.execute('DELETE FROM offline_notification_outbox WHERE user_id = ? AND sequence = ?', [
        userId,
        sequence,
      ])
    );
  }
}
