export type OfflineActivityKind = 'bookmark' | 'like' | 'progress';

type SQLiteValue = string | number | null;

export interface OfflineTransaction {
  execute(statement: string, values?: SQLiteValue[]): Promise<void>;
  query(statement: string, values?: SQLiteValue[]): Promise<Record<string, unknown>[]>;
}

export interface OfflineDatabase {
  // Transactions must be exclusive, including while awaiting the callback.
  transaction<T>(callback: (database: OfflineTransaction) => Promise<T>): Promise<T>;
}

export interface PendingActivity {
  operationId: string;
  userId: string;
  topicId: string;
  kind: OfflineActivityKind;
  value: boolean;
}

const kinds: OfflineActivityKind[] = ['bookmark', 'like', 'progress'];

function assertKey(value: string, name: string) {
  if (!value || value.trim() !== value) {
    throw new Error(`Invalid ${name}.`);
  }
}

function assertKind(kind: OfflineActivityKind) {
  if (!kinds.includes(kind)) throw new Error('Invalid offline activity kind.');
}

function isActivityKind(value: unknown): value is OfflineActivityKind {
  return value === 'bookmark' || value === 'like' || value === 'progress';
}

function parseActivity(row: Record<string, unknown>): PendingActivity {
  const { operation_id, user_id, topic_id, kind, value } = row;
  if (
    typeof operation_id !== 'string' ||
    typeof user_id !== 'string' ||
    typeof topic_id !== 'string' ||
    !isActivityKind(kind) ||
    (value !== 0 && value !== 1)
  ) {
    throw new Error('The offline activity queue contains an invalid entry.');
  }
  return {
    operationId: operation_id,
    userId: user_id,
    topicId: topic_id,
    kind,
    value: value === 1,
  };
}

export class OfflineActivityStore {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity (
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1)),
          PRIMARY KEY (user_id, topic_id, kind)
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1))
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_activity_outbox_user_sequence
        ON offline_activity_outbox(user_id, sequence)
      `);
    });
  }

  async setActivity(
    userId: string,
    topicId: string,
    kind: OfflineActivityKind,
    value: boolean,
    operationId: string
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(topicId, 'topic ID');
    assertKey(operationId, 'operation ID');
    assertKind(kind);
    if (typeof value !== 'boolean') throw new Error('Invalid offline activity value.');

    await this.database.transaction(async (db) => {
      await db.execute(
        `INSERT OR REPLACE INTO offline_activity (user_id, topic_id, kind, value)
         VALUES (?, ?, ?, ?)`,
        [userId, topicId, kind, value ? 1 : 0]
      );
      await db.execute(
        `INSERT INTO offline_activity_outbox (operation_id, user_id, topic_id, kind, value)
         VALUES (?, ?, ?, ?, ?)`,
        [operationId, userId, topicId, kind, value ? 1 : 0]
      );
    });
  }

  async getActivity(
    userId: string,
    topicId: string,
    kind: OfflineActivityKind
  ): Promise<boolean | null> {
    assertKey(userId, 'user ID');
    assertKey(topicId, 'topic ID');
    assertKind(kind);
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT value FROM offline_activity WHERE user_id = ? AND topic_id = ? AND kind = ?',
        [userId, topicId, kind]
      );
      if (rows.length === 0) return null;
      if (rows.length !== 1 || (rows[0].value !== 0 && rows[0].value !== 1)) {
        throw new Error('The offline activity state is invalid.');
      }
      return rows[0].value === 1;
    });
  }

  async nextOperation(userId: string): Promise<PendingActivity | null> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id, user_id, topic_id, kind, value
         FROM offline_activity_outbox WHERE user_id = ? ORDER BY sequence LIMIT 1`,
        [userId]
      );
      return rows.length ? parseActivity(rows[0]) : null;
    });
  }

  async acknowledge(userId: string, operationId: string): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(operationId, 'operation ID');
    await this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id FROM offline_activity_outbox
         WHERE user_id = ? ORDER BY sequence LIMIT 1`,
        [userId]
      );
      if (rows.length !== 1 || rows[0].operation_id !== operationId) {
        throw new Error('Only the first pending operation can be acknowledged.');
      }
      await db.execute(
        'DELETE FROM offline_activity_outbox WHERE operation_id = ? AND user_id = ?',
        [operationId, userId]
      );
    });
  }
}
