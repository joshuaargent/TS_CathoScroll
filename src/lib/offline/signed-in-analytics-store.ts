import type { OfflineDatabase, OfflineTransaction } from './activity-store';

export type SignedInAnalyticsStream = 'topic' | 'comment';
export type SignedInAnalyticsPayload = {
  event_id: string;
  session_id: string;
  event_type: string;
  [key: string]: unknown;
};

export interface SignedInAnalyticsOutbox {
  initialize(): Promise<void>;
  enqueue(userId: string, stream: SignedInAnalyticsStream, payload: SignedInAnalyticsPayload): Promise<void>;
  pending(userId: string, stream: SignedInAnalyticsStream, limit: number): Promise<SignedInAnalyticsPayload[]>;
  acknowledge(userId: string, stream: SignedInAnalyticsStream, eventIds: string[]): Promise<void>;
  clearUser(userId: string): Promise<void>;
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
  if (stream !== 'topic' && stream !== 'comment') throw new Error('Invalid signed-in analytics stream.');
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
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_signed_in_analytics_outbox (
          user_id TEXT NOT NULL,
          stream TEXT NOT NULL CHECK (stream IN ('topic', 'comment')),
          event_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, stream, event_id)
        )
      `);
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
    await db.execute(`
      DELETE FROM offline_signed_in_analytics_outbox
      WHERE rowid NOT IN (
        SELECT rowid FROM offline_signed_in_analytics_outbox
        WHERE user_id = offline_signed_in_analytics_outbox.user_id
          AND stream = offline_signed_in_analytics_outbox.stream
        ORDER BY created_at DESC, event_id DESC
        LIMIT ?
      )
    `, [maximumEventsPerStream]);
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
}
