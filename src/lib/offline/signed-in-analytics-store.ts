import type { OfflineDatabase, OfflineTransaction } from './activity-store';

export type SignedInAnalyticsStream = 'topic' | 'comment' | 'sponsor';
export type SignedInAnalyticsPayload = object & {
  event_id: string;
  session_id: string;
  event_type: string;
  campaign_id?: string;
  placement_receipt?: string;
  duration_ms?: number | null;
};

export interface SignedInAnalyticsOutbox {
  initialize(): Promise<void>;
  enqueue(userId: string, stream: SignedInAnalyticsStream, payload: SignedInAnalyticsPayload): Promise<void>;
  pending(userId: string, stream: SignedInAnalyticsStream, limit: number): Promise<SignedInAnalyticsPayload[]>;
  acknowledge(userId: string, stream: SignedInAnalyticsStream, eventIds: string[]): Promise<void>;
  clearUser(userId: string): Promise<void>;
  clearStream(userId: string, stream: SignedInAnalyticsStream): Promise<void>;
}

const releaseConsentResetMigration = 'analytics-consent-v2-release-reset';

export async function resetLegacySignedInAnalyticsOutbox(database: OfflineDatabase): Promise<void> {
  await database.transaction(async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS offline_native_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const rows = await db.query(
      'SELECT migration_key FROM offline_native_migrations WHERE migration_key = ?',
      [releaseConsentResetMigration]
    );
    if (rows.length > 0) return;
    // The 2.4.0 consent reset invalidates every pre-release analytics grant.
    // Discard pending encrypted events once; subsequent newly consented events
    // remain durable across normal application restarts.
    await db.execute('DROP TABLE IF EXISTS offline_signed_in_analytics_outbox');
    await db.execute(
      'INSERT INTO offline_native_migrations (migration_key, applied_at) VALUES (?, ?)',
      [releaseConsentResetMigration, new Date().toISOString()]
    );
  });
}

const maximumEventsPerStream = 2000;
const maximumAgeMs = 7 * 24 * 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUserId(userId: string): void {
  if (typeof userId !== 'string' || !userId || userId.trim() !== userId || userId.length > 128) {
    throw new Error('Invalid signed-in analytics account.');
  }
}

function assertStream(stream: SignedInAnalyticsStream): void {
  if (stream !== 'topic' && stream !== 'comment' && stream !== 'sponsor') throw new Error('Invalid signed-in analytics stream.');
}

function validatePayload(payload: SignedInAnalyticsPayload): void {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !uuidPattern.test(payload.event_id) ||
    !uuidPattern.test(payload.session_id) ||
    typeof payload.event_type !== 'string' ||
    payload.event_type.length > 40
  ) throw new Error('Invalid signed-in analytics event.');
  const encoded = JSON.stringify(payload);
  if (typeof encoded !== 'string' || encoded.length > 16_384) {
    throw new Error('Signed-in analytics event is too large.');
  }
}

export class NativeSignedInAnalyticsOutbox implements SignedInAnalyticsOutbox {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      const existing = await db.query(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'offline_signed_in_analytics_outbox'"
      );
      if (existing.length > 1 || (existing.length === 1 && typeof existing[0].sql !== 'string')) {
        throw new Error('The signed-in analytics outbox schema is invalid.');
      }
      if (existing.length === 1 && !String(existing[0].sql).includes("'sponsor'")) {
        // Upgrade an earlier preview build that created a topic/comment-only
        // CHECK constraint. Preserve pending events atomically.
        await db.execute('DROP INDEX IF EXISTS offline_signed_in_analytics_pending');
        await db.execute('ALTER TABLE offline_signed_in_analytics_outbox RENAME TO offline_signed_in_analytics_outbox_v1');
        await db.execute(`
          CREATE TABLE offline_signed_in_analytics_outbox (
            user_id TEXT NOT NULL,
            stream TEXT NOT NULL CHECK (stream IN ('topic', 'comment', 'sponsor')),
            event_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, stream, event_id)
          )
        `);
        await db.execute(`
          INSERT INTO offline_signed_in_analytics_outbox (user_id, stream, event_id, payload, created_at)
          SELECT user_id, stream, event_id, payload, created_at
          FROM offline_signed_in_analytics_outbox_v1
        `);
        await db.execute('DROP TABLE offline_signed_in_analytics_outbox_v1');
      } else if (existing.length === 0) {
        await db.execute(`
          CREATE TABLE offline_signed_in_analytics_outbox (
            user_id TEXT NOT NULL,
            stream TEXT NOT NULL CHECK (stream IN ('topic', 'comment', 'sponsor')),
            event_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, stream, event_id)
          )
        `);
      }
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_signed_in_analytics_pending
        ON offline_signed_in_analytics_outbox(user_id, stream, created_at)
      `);
      await this.prune(db);
    });
  }

  private async prune(db: OfflineTransaction): Promise<void> {
    await db.execute(
      'DELETE FROM offline_signed_in_analytics_outbox WHERE created_at < ?',
      [new Date(Date.now() - maximumAgeMs).toISOString()]
    );
  }

  async enqueue(userId: string, stream: SignedInAnalyticsStream, payload: SignedInAnalyticsPayload): Promise<void> {
    assertUserId(userId);
    assertStream(stream);
    validatePayload(payload);
    await this.database.transaction(async (db) => {
      await this.prune(db);
      await db.execute(
        'INSERT OR IGNORE INTO offline_signed_in_analytics_outbox (user_id, stream, event_id, payload, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId, stream, payload.event_id, JSON.stringify(payload), new Date().toISOString()]
      );
      await db.execute(`
        DELETE FROM offline_signed_in_analytics_outbox
        WHERE user_id = ? AND stream = ? AND event_id NOT IN (
          SELECT event_id FROM offline_signed_in_analytics_outbox
          WHERE user_id = ? AND stream = ?
          ORDER BY created_at DESC, event_id DESC LIMIT ?
        )
      `, [userId, stream, userId, stream, maximumEventsPerStream]);
    });
  }

  async pending(userId: string, stream: SignedInAnalyticsStream, limit: number): Promise<SignedInAnalyticsPayload[]> {
    assertUserId(userId);
    assertStream(stream);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid signed-in analytics batch size.');
    return this.database.transaction(async (db) => {
      await this.prune(db);
      const rows = await db.query(
        'SELECT payload FROM offline_signed_in_analytics_outbox WHERE user_id = ? AND stream = ? ORDER BY created_at ASC, event_id ASC LIMIT ?',
        [userId, stream, limit]
      );
      return rows.map((row) => {
        if (typeof row.payload !== 'string') throw new Error('Corrupt signed-in analytics outbox payload.');
        const payload = JSON.parse(row.payload) as SignedInAnalyticsPayload;
        validatePayload(payload);
        return payload;
      });
    });
  }

  async acknowledge(userId: string, stream: SignedInAnalyticsStream, eventIds: string[]): Promise<void> {
    assertUserId(userId);
    assertStream(stream);
    if (!Array.isArray(eventIds) || eventIds.length > 100 || eventIds.some((id) => typeof id !== 'string' || !uuidPattern.test(id)) || new Set(eventIds).size !== eventIds.length) {
      throw new Error('Invalid signed-in analytics acknowledgement.');
    }
    if (!eventIds.length) return;
    await this.database.transaction((db) => db.execute(
      'DELETE FROM offline_signed_in_analytics_outbox WHERE user_id = ? AND stream = ? AND event_id IN (' + eventIds.map(() => '?').join(', ') + ')',
      [userId, stream, ...eventIds]
    ));
  }

  async clearUser(userId: string): Promise<void> {
    assertUserId(userId);
    await this.database.transaction((db) => db.execute(
      'DELETE FROM offline_signed_in_analytics_outbox WHERE user_id = ?',
      [userId]
    ));
  }

  async clearStream(userId: string, stream: SignedInAnalyticsStream): Promise<void> {
    assertUserId(userId);
    assertStream(stream);
    await this.database.transaction((db) => db.execute(
      'DELETE FROM offline_signed_in_analytics_outbox WHERE user_id = ? AND stream = ?',
      [userId, stream]
    ));
  }
}
