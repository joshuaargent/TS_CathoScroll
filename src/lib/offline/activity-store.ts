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

export interface ServerActivity {
  topicId: string;
  kind: OfflineActivityKind;
  value: boolean;
  revision: string;
}

export interface SnapshotActivity {
  topicId: string;
  kind: OfflineActivityKind;
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

function revision(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid offline activity revision.');
  return BigInt(value);
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
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_server (
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1)),
          revision TEXT NOT NULL,
          PRIMARY KEY (user_id, topic_id, kind)
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_cursor (
          user_id TEXT PRIMARY KEY NOT NULL,
          revision TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_bootstrap (
          user_id TEXT PRIMARY KEY NOT NULL,
          snapshot_id TEXT NOT NULL,
          revision TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_bootstrap_items (
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          PRIMARY KEY (user_id, topic_id, kind)
        )
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

  async acknowledge(
    userId: string,
    operationId: string,
    serverRevision: string,
    serverValue: boolean
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(operationId, 'operation ID');
    if (revision(serverRevision) === BigInt(0) || typeof serverValue !== 'boolean') {
      throw new Error('Invalid offline activity receipt.');
    }
    await this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id, user_id, topic_id, kind, value FROM offline_activity_outbox
         WHERE user_id = ? ORDER BY sequence LIMIT 1`,
        [userId]
      );
      if (rows.length !== 1 || rows[0].operation_id !== operationId) {
        throw new Error('Only the first pending operation can be acknowledged.');
      }
      const operation = parseActivity(rows[0]);
      if (serverValue !== operation.value) {
        throw new Error('The offline activity receipt has an unexpected value.');
      }
      await this.updateServerState(db, userId, {
        topicId: operation.topicId,
        kind: operation.kind,
        value: serverValue,
        revision: serverRevision,
      });
      await db.execute(
        'DELETE FROM offline_activity_outbox WHERE operation_id = ? AND user_id = ?',
        [operationId, userId]
      );
      await this.refreshVisibleState(db, userId, operation.topicId, operation.kind);
    });
  }

  async cursor(userId: string): Promise<string> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (!rows.length) return '0';
      if (rows.length !== 1 || typeof rows[0].revision !== 'string') {
        throw new Error('The offline activity cursor is invalid.');
      }
      revision(rows[0].revision);
      return rows[0].revision;
    });
  }

  async isBootstrapped(userId: string): Promise<boolean> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (!rows.length) return false;
      if (rows.length !== 1 || typeof rows[0].revision !== 'string') {
        throw new Error('The offline activity cursor is invalid.');
      }
      revision(rows[0].revision);
      return true;
    });
  }

  async beginBootstrap(userId: string, snapshotId: string, startRevision: string): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    revision(startRevision);
    await this.database.transaction(async (db) => {
      const cursors = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (cursors.length) throw new Error('Offline activity has already been initialized.');
      await db.execute('DELETE FROM offline_activity_bootstrap_items WHERE user_id = ?', [userId]);
      await db.execute('INSERT OR REPLACE INTO offline_activity_bootstrap VALUES (?, ?, ?)', [
        userId,
        snapshotId,
        startRevision,
      ]);
    });
  }

  async stageBootstrap(
    userId: string,
    snapshotId: string,
    items: SnapshotActivity[]
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    for (const item of items) {
      assertKey(item.topicId, 'topic ID');
      assertKind(item.kind);
    }
    await this.database.transaction(async (db) => {
      await this.assertBootstrap(db, userId, snapshotId);
      for (const item of items) {
        await db.execute(
          'INSERT OR IGNORE INTO offline_activity_bootstrap_items VALUES (?, ?, ?)',
          [userId, item.topicId, item.kind]
        );
      }
    });
  }

  async completeBootstrap(userId: string, snapshotId: string): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    await this.database.transaction(async (db) => {
      const startRevision = await this.assertBootstrap(db, userId, snapshotId);
      const cursors = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (cursors.length) throw new Error('Offline activity has already been initialized.');
      await db.execute(
        `INSERT INTO offline_activity_server (user_id, topic_id, kind, value, revision)
         SELECT user_id, topic_id, kind, 1, ?
         FROM offline_activity_bootstrap_items WHERE user_id = ?
         ON CONFLICT (user_id, topic_id, kind) DO UPDATE
         SET value = excluded.value, revision = excluded.revision
         WHERE length(excluded.revision) > length(offline_activity_server.revision)
            OR (length(excluded.revision) = length(offline_activity_server.revision)
                AND excluded.revision >= offline_activity_server.revision)`,
        [startRevision, userId]
      );
      await db.execute(
        `INSERT OR REPLACE INTO offline_activity (user_id, topic_id, kind, value)
         SELECT server.user_id, server.topic_id, server.kind,
           COALESCE((SELECT pending.value FROM offline_activity_outbox pending
             WHERE pending.user_id = server.user_id AND pending.topic_id = server.topic_id
               AND pending.kind = server.kind ORDER BY pending.sequence DESC LIMIT 1), server.value)
         FROM offline_activity_server server WHERE server.user_id = ?`,
        [userId]
      );
      await db.execute('INSERT INTO offline_activity_cursor VALUES (?, ?)', [
        userId,
        startRevision,
      ]);
      await db.execute('DELETE FROM offline_activity_bootstrap_items WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM offline_activity_bootstrap WHERE user_id = ?', [userId]);
    });
  }

  private async assertBootstrap(
    db: OfflineTransaction,
    userId: string,
    snapshotId: string
  ): Promise<string> {
    const rows = await db.query(
      'SELECT revision FROM offline_activity_bootstrap WHERE user_id = ? AND snapshot_id = ?',
      [userId, snapshotId]
    );
    if (rows.length !== 1 || typeof rows[0].revision !== 'string') {
      throw new Error('Offline activity bootstrap is missing or has been replaced.');
    }
    revision(rows[0].revision);
    return rows[0].revision;
  }

  async applyChanges(userId: string, changes: ServerActivity[]): Promise<void> {
    assertKey(userId, 'user ID');
    for (const change of changes) {
      assertKey(change.topicId, 'topic ID');
      assertKind(change.kind);
      if (revision(change.revision) === BigInt(0) || typeof change.value !== 'boolean') {
        throw new Error('Invalid offline activity change.');
      }
    }
    if (!changes.length) return;

    await this.database.transaction(async (db) => {
      const cursorRows = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      const currentCursor = cursorRows.length ? cursorRows[0].revision : '0';
      if (typeof currentCursor !== 'string') throw new Error('Invalid offline activity cursor.');
      let previous = revision(currentCursor);
      for (const change of changes) {
        const next = revision(change.revision);
        if (next !== previous + BigInt(1)) {
          throw new Error('Offline activity changes are out of order or incomplete.');
        }
        previous = next;
        await this.updateServerState(db, userId, change);
        await this.refreshVisibleState(db, userId, change.topicId, change.kind);
      }
      await db.execute('INSERT OR REPLACE INTO offline_activity_cursor VALUES (?, ?)', [
        userId,
        previous.toString(),
      ]);
    });
  }

  private async updateServerState(
    db: OfflineTransaction,
    userId: string,
    change: ServerActivity
  ): Promise<void> {
    const rows = await db.query(
      'SELECT revision, value FROM offline_activity_server WHERE user_id = ? AND topic_id = ? AND kind = ?',
      [userId, change.topicId, change.kind]
    );
    if (rows.length) {
      const existing = rows[0].revision;
      if (typeof existing !== 'string') throw new Error('Invalid stored activity revision.');
      if (revision(existing) === revision(change.revision)) {
        if (rows[0].value !== (change.value ? 1 : 0)) {
          throw new Error('Conflicting offline activity revisions.');
        }
        return;
      }
      if (revision(existing) > revision(change.revision)) return;
    }
    await db.execute('INSERT OR REPLACE INTO offline_activity_server VALUES (?, ?, ?, ?, ?)', [
      userId,
      change.topicId,
      change.kind,
      change.value ? 1 : 0,
      change.revision,
    ]);
  }

  private async refreshVisibleState(
    db: OfflineTransaction,
    userId: string,
    topicId: string,
    kind: OfflineActivityKind
  ): Promise<void> {
    const pending = await db.query(
      `SELECT value FROM offline_activity_outbox
       WHERE user_id = ? AND topic_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1`,
      [userId, topicId, kind]
    );
    const server = pending.length
      ? pending
      : await db.query(
          'SELECT value FROM offline_activity_server WHERE user_id = ? AND topic_id = ? AND kind = ?',
          [userId, topicId, kind]
        );
    if (server.length !== 1 || (server[0].value !== 0 && server[0].value !== 1)) {
      throw new Error('Unable to reconcile offline activity state.');
    }
    await db.execute('INSERT OR REPLACE INTO offline_activity VALUES (?, ?, ?, ?)', [
      userId,
      topicId,
      kind,
      server[0].value,
    ]);
  }
}
