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
  completedAt: string | null;
}

export interface ServerActivity {
  topicId: string;
  kind: OfflineActivityKind;
  value: boolean;
  revision: string;
  completedAt: string | null;
}

export interface SnapshotActivity {
  topicId: string;
  kind: OfflineActivityKind;
  completedAt: string | null;
}

export interface OfflineTopicActivity {
  liked: boolean;
  bookmarked: boolean;
  completed: boolean;
  completedAt: string | null;
}

const kinds: OfflineActivityKind[] = ['bookmark', 'like', 'progress'];

function assertKey(value: string, name: string) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`Invalid ${name}.`);
  }
}

function assertKind(kind: OfflineActivityKind) {
  if (!kinds.includes(kind)) throw new Error('Invalid offline activity kind.');
}

function revision(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Invalid offline activity revision.');
  }
  return BigInt(value);
}

function isActivityKind(value: unknown): value is OfflineActivityKind {
  return value === 'bookmark' || value === 'like' || value === 'progress';
}

function completionTime(
  kind: OfflineActivityKind,
  value: boolean,
  completedAt: unknown
): string | null {
  if (kind !== 'progress' || !value) {
    if (completedAt !== null && completedAt !== undefined) {
      throw new Error('Invalid offline completion time.');
    }
    return null;
  }
  if (
    typeof completedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(completedAt) ||
    Number.isNaN(Date.parse(completedAt))
  ) {
    throw new Error('Invalid offline completion time.');
  }
  return completedAt;
}

function sameCompletionTime(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const subMilliseconds = (value: string) =>
    (/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(3, '0').slice(3).replace(/0+$/, '');
  return Date.parse(left) === Date.parse(right) && subMilliseconds(left) === subMilliseconds(right);
}

function parseActivity(row: Record<string, unknown>): PendingActivity {
  const { operation_id, user_id, topic_id, kind, value, completed_at } = row;
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
    completedAt: completionTime(kind, value === 1, completed_at),
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
          completed_at TEXT,
          PRIMARY KEY (user_id, topic_id, kind)
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_activity_user_kind_value_topic
        ON offline_activity(user_id, kind, value, topic_id)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1)),
          completed_at TEXT
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_activity_outbox_user_sequence
        ON offline_activity_outbox(user_id, sequence)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_rejections (
          operation_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1)),
          completed_at TEXT,
          reason TEXT NOT NULL CHECK (reason = 'topic_unavailable'),
          notified INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1))
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_activity_rejections_user_notified
        ON offline_activity_rejections(user_id, notified)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_server (
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL CHECK (value IN (0, 1)),
          revision TEXT NOT NULL,
          completed_at TEXT,
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
          revision TEXT NOT NULL,
          base_cursor TEXT
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_bootstrap_items (
          user_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'like', 'progress')),
          value INTEGER NOT NULL DEFAULT 1 CHECK (value IN (0, 1)),
          completed_at TEXT,
          PRIMARY KEY (user_id, topic_id, kind)
        )
      `);
      const columns = await db.query('PRAGMA table_info(offline_activity_bootstrap_items)');
      if (!columns.some((column) => column.name === 'value')) {
        await db.execute(
          'ALTER TABLE offline_activity_bootstrap_items ADD COLUMN value INTEGER NOT NULL DEFAULT 1 CHECK (value IN (0, 1))'
        );
      }
      const bootstrapColumns = await db.query('PRAGMA table_info(offline_activity_bootstrap)');
      if (!bootstrapColumns.some((column) => column.name === 'base_cursor')) {
        await db.execute('ALTER TABLE offline_activity_bootstrap ADD COLUMN base_cursor TEXT');
      }
      for (const table of [
        'offline_activity',
        'offline_activity_outbox',
        'offline_activity_server',
        'offline_activity_bootstrap_items',
      ]) {
        const tableColumns = await db.query(`PRAGMA table_info(${table})`);
        if (!tableColumns.some((column) => column.name === 'completed_at')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN completed_at TEXT`);
        }
      }
    });
  }

  async setActivity(
    userId: string,
    topicId: string,
    kind: OfflineActivityKind,
    value: boolean,
    operationId: string,
    completedAt: string | null = kind === 'progress' && value ? new Date().toISOString() : null
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(topicId, 'topic ID');
    assertKey(operationId, 'operation ID');
    assertKind(kind);
    if (typeof value !== 'boolean') throw new Error('Invalid offline activity value.');
    completionTime(kind, value, completedAt);

    await this.database.transaction(async (db) => {
      await db.execute(
        `INSERT OR REPLACE INTO offline_activity (user_id, topic_id, kind, value, completed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, topicId, kind, value ? 1 : 0, completedAt]
      );
      await db.execute(
        `INSERT INTO offline_activity_outbox (operation_id, user_id, topic_id, kind, value, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [operationId, userId, topicId, kind, value ? 1 : 0, completedAt]
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

  async topicActivity(userId: string, topicId: string): Promise<OfflineTopicActivity> {
    assertKey(userId, 'user ID');
    assertKey(topicId, 'topic ID');
    return this.database.transaction(async (db) => {
      await this.assertInitialized(db, userId);
      const rows = await db.query(
        'SELECT kind, value, completed_at FROM offline_activity WHERE user_id = ? AND topic_id = ?',
        [userId, topicId]
      );
      const state: OfflineTopicActivity = {
        liked: false,
        bookmarked: false,
        completed: false,
        completedAt: null,
      };
      for (const row of rows) {
        if (!isActivityKind(row.kind) || (row.value !== 0 && row.value !== 1)) {
          throw new Error('The offline activity state is invalid.');
        }
        const key =
          row.kind === 'like' ? 'liked' : row.kind === 'bookmark' ? 'bookmarked' : 'completed';
        state[key] = row.value === 1;
        const completedAt = completionTime(row.kind, row.value === 1, row.completed_at);
        if (row.kind === 'progress') state.completedAt = completedAt;
      }
      return state;
    });
  }

  async listActivity(
    userId: string,
    kind: OfflineActivityKind,
    cursor?: string
  ): Promise<{ topicIds: string[]; nextCursor: string | null }> {
    assertKey(userId, 'user ID');
    assertKind(kind);
    if (cursor !== undefined) assertKey(cursor, 'activity cursor');
    return this.database.transaction(async (db) => {
      await this.assertInitialized(db, userId);
      const rows = await db.query(
        `SELECT topic_id FROM offline_activity
         WHERE user_id = ? AND kind = ? AND value = 1 ${cursor ? 'AND topic_id > ?' : ''}
         ORDER BY topic_id LIMIT 51`,
        cursor ? [userId, kind, cursor] : [userId, kind]
      );
      const ids = rows.map((row) => {
        if (typeof row.topic_id !== 'string') throw new Error('Invalid offline activity topic.');
        assertKey(row.topic_id, 'activity topic');
        return row.topic_id;
      });
      return { topicIds: ids.slice(0, 50), nextCursor: ids.length > 50 ? ids[49] : null };
    });
  }

  async pendingCount(userId: string): Promise<number> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT COUNT(*) AS count FROM offline_activity_outbox WHERE user_id = ?',
        [userId]
      );
      const count = rows[0]?.count;
      if (
        rows.length !== 1 ||
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new Error('Invalid offline activity queue count.');
      }
      return count;
    });
  }

  private async assertInitialized(db: OfflineTransaction, userId: string): Promise<void> {
    const rows = await db.query('SELECT revision FROM offline_activity_cursor WHERE user_id = ?', [
      userId,
    ]);
    if (rows.length !== 1 || typeof rows[0].revision !== 'string') {
      throw new Error('Offline activity must be initialized before reading account state.');
    }
    revision(rows[0].revision);
  }

  async nextOperation(userId: string): Promise<PendingActivity | null> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id, user_id, topic_id, kind, value, completed_at
         FROM offline_activity_outbox WHERE user_id = ? ORDER BY sequence LIMIT 1`,
        [userId]
      );
      return rows.length ? parseActivity(rows[0]) : null;
    });
  }

  async rejectUnavailableTopic(userId: string, operationId: string): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(operationId, 'operation ID');
    await this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id, user_id, topic_id, kind, value, completed_at FROM offline_activity_outbox
         WHERE user_id = ? ORDER BY sequence LIMIT 1`,
        [userId]
      );
      if (rows.length !== 1 || rows[0].operation_id !== operationId) {
        throw new Error('Only the first pending operation can be rejected.');
      }
      const operation = parseActivity(rows[0]);
      if (!operation.value) throw new Error('Invalid unavailable topic rejection.');
      await db.execute(
        `INSERT INTO offline_activity_rejections
         (operation_id, user_id, topic_id, kind, value, completed_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, 'topic_unavailable')`,
        [operation.operationId, userId, operation.topicId, operation.kind, 1, operation.completedAt]
      );
      await db.execute(
        'DELETE FROM offline_activity_outbox WHERE user_id = ? AND operation_id = ?',
        [userId, operationId]
      );
      await this.refreshVisibleState(db, userId, operation.topicId, operation.kind, true);
    });
  }

  async unnotifiedRejectionCount(userId: string): Promise<number> {
    assertKey(userId, 'user ID');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT COUNT(*) AS count FROM offline_activity_rejections WHERE user_id = ? AND notified = 0',
        [userId]
      );
      const count = rows[0]?.count;
      if (
        rows.length !== 1 ||
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new Error('Invalid offline activity rejection count.');
      }
      return count;
    });
  }

  async dismissRejections(userId: string): Promise<void> {
    assertKey(userId, 'user ID');
    await this.database.transaction(async (db) => {
      await db.execute(
        'UPDATE offline_activity_rejections SET notified = 1 WHERE user_id = ? AND notified = 0',
        [userId]
      );
    });
  }

  async acknowledge(
    userId: string,
    operationId: string,
    serverRevision: string,
    serverValue: boolean,
    completedAt: string | null = null
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(operationId, 'operation ID');
    if (revision(serverRevision) === BigInt(0) || typeof serverValue !== 'boolean') {
      throw new Error('Invalid offline activity receipt.');
    }
    await this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT operation_id, user_id, topic_id, kind, value, completed_at FROM offline_activity_outbox
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
      completionTime(operation.kind, serverValue, completedAt);
      await this.updateServerState(db, userId, {
        topicId: operation.topicId,
        kind: operation.kind,
        value: serverValue,
        revision: serverRevision,
        completedAt,
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

  async beginBootstrap(
    userId: string,
    snapshotId: string,
    startRevision: string,
    replaceExisting = false
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    revision(startRevision);
    await this.database.transaction(async (db) => {
      const cursors = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (cursors.length > 1 || (cursors.length && typeof cursors[0].revision !== 'string')) {
        throw new Error('The offline activity cursor is invalid.');
      }
      if (cursors.length && !replaceExisting) {
        throw new Error('Offline activity has already been initialized.');
      }
      const baseCursor = cursors.length ? String(cursors[0].revision) : null;
      if (baseCursor !== null && revision(startRevision) < revision(baseCursor)) {
        throw new Error('Offline activity revision went backwards.');
      }
      await db.execute('DELETE FROM offline_activity_bootstrap_items WHERE user_id = ?', [userId]);
      await db.execute(
        `INSERT OR REPLACE INTO offline_activity_bootstrap
         (user_id, snapshot_id, revision, base_cursor) VALUES (?, ?, ?, ?)`,
        [userId, snapshotId, startRevision, baseCursor]
      );
    });
  }

  async stageBootstrap(
    userId: string,
    snapshotId: string,
    items: SnapshotActivity[]
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    if (!Array.isArray(items)) throw new Error('Invalid offline activity snapshot items.');
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        throw new Error('Invalid offline activity snapshot item.');
      }
      assertKey(item.topicId, 'topic ID');
      assertKind(item.kind);
      completionTime(item.kind, true, item.completedAt);
    }
    await this.database.transaction(async (db) => {
      await this.assertBootstrap(db, userId, snapshotId);
      for (const item of items) {
        await db.execute(
          `INSERT OR IGNORE INTO offline_activity_bootstrap_items (user_id, topic_id, kind, value, completed_at)
           VALUES (?, ?, ?, 1, ?)`,
          [userId, item.topicId, item.kind, item.completedAt ?? null]
        );
      }
    });
  }

  async applyBootstrapChanges(
    userId: string,
    snapshotId: string,
    changes: ServerActivity[]
  ): Promise<void> {
    assertKey(userId, 'user ID');
    assertKey(snapshotId, 'snapshot ID');
    if (!Array.isArray(changes)) throw new Error('Invalid offline activity changes.');
    for (const change of changes) {
      if (!change || typeof change !== 'object')
        throw new Error('Invalid offline activity change.');
      assertKey(change.topicId, 'topic ID');
      assertKind(change.kind);
      if (revision(change.revision) === BigInt(0) || typeof change.value !== 'boolean') {
        throw new Error('Invalid offline activity change.');
      }
      completionTime(change.kind, change.value, change.completedAt);
    }
    await this.database.transaction(async (db) => {
      let previous = revision(await this.assertBootstrap(db, userId, snapshotId));
      for (const change of changes) {
        const next = revision(change.revision);
        if (next !== previous + BigInt(1)) {
          throw new Error('Offline activity changes are out of order or incomplete.');
        }
        await db.execute(
          `INSERT OR REPLACE INTO offline_activity_bootstrap_items
           (user_id, topic_id, kind, value, completed_at) VALUES (?, ?, ?, ?, ?)`,
          [userId, change.topicId, change.kind, change.value ? 1 : 0, change.completedAt ?? null]
        );
        previous = next;
      }
      await db.execute(
        'UPDATE offline_activity_bootstrap SET revision = ? WHERE user_id = ? AND snapshot_id = ?',
        [previous.toString(), userId, snapshotId]
      );
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
      const bootstrap = await db.query(
        'SELECT base_cursor FROM offline_activity_bootstrap WHERE user_id = ? AND snapshot_id = ?',
        [userId, snapshotId]
      );
      if (bootstrap.length !== 1) throw new Error('Offline activity bootstrap is unavailable.');
      const baseCursor = bootstrap[0].base_cursor;
      if (
        (baseCursor !== null && typeof baseCursor !== 'string') ||
        (baseCursor === null && cursors.length !== 0) ||
        (typeof baseCursor === 'string' &&
          (cursors.length !== 1 || cursors[0].revision !== baseCursor))
      ) {
        throw new Error('Offline activity changed during bootstrap.');
      }
      const missingCompletionTimes = await db.query(
        `SELECT 1 FROM offline_activity_bootstrap_items
         WHERE user_id = ? AND kind = 'progress' AND value = 1 AND completed_at IS NULL LIMIT 1`,
        [userId]
      );
      if (missingCompletionTimes.length) {
        throw new Error('The saved activity snapshot is missing a completion time.');
      }
      if (baseCursor !== null) {
        await db.execute(
          `DELETE FROM offline_activity_server
           WHERE user_id = ? AND (
             length(revision) < length(?) OR (length(revision) = length(?) AND revision <= ?)
           ) AND NOT EXISTS (
             SELECT 1 FROM offline_activity_bootstrap_items staged
             WHERE staged.user_id = offline_activity_server.user_id
               AND staged.topic_id = offline_activity_server.topic_id
               AND staged.kind = offline_activity_server.kind
           )`,
          [userId, startRevision, startRevision, startRevision]
        );
      }
      await db.execute(
        `INSERT INTO offline_activity_server (user_id, topic_id, kind, value, revision, completed_at)
         SELECT user_id, topic_id, kind, value, ?, completed_at
         FROM offline_activity_bootstrap_items WHERE user_id = ?
         ON CONFLICT (user_id, topic_id, kind) DO UPDATE
         SET value = excluded.value, revision = excluded.revision, completed_at = excluded.completed_at
         WHERE length(excluded.revision) > length(offline_activity_server.revision)
            OR (length(excluded.revision) = length(offline_activity_server.revision)
                AND excluded.revision >= offline_activity_server.revision)`,
        [startRevision, userId]
      );
      if (baseCursor !== null) {
        await db.execute(
          `DELETE FROM offline_activity WHERE user_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM offline_activity_server server
             WHERE server.user_id = offline_activity.user_id
               AND server.topic_id = offline_activity.topic_id AND server.kind = offline_activity.kind
           )
           AND NOT EXISTS (
             SELECT 1 FROM offline_activity_outbox pending
             WHERE pending.user_id = offline_activity.user_id
               AND pending.topic_id = offline_activity.topic_id AND pending.kind = offline_activity.kind
           )`,
          [userId]
        );
      }
      await db.execute(
        `INSERT OR REPLACE INTO offline_activity (user_id, topic_id, kind, value, completed_at)
         SELECT server.user_id, server.topic_id, server.kind,
           COALESCE((SELECT pending.value FROM offline_activity_outbox pending
             WHERE pending.user_id = server.user_id AND pending.topic_id = server.topic_id
               AND pending.kind = server.kind ORDER BY pending.sequence DESC LIMIT 1), server.value),
           CASE WHEN EXISTS (SELECT 1 FROM offline_activity_outbox pending
             WHERE pending.user_id = server.user_id AND pending.topic_id = server.topic_id
               AND pending.kind = server.kind) THEN
             (SELECT pending.completed_at FROM offline_activity_outbox pending
              WHERE pending.user_id = server.user_id AND pending.topic_id = server.topic_id
                AND pending.kind = server.kind ORDER BY pending.sequence DESC LIMIT 1)
           ELSE server.completed_at END
         FROM offline_activity_server server WHERE server.user_id = ?`,
        [userId]
      );
      await db.execute('INSERT OR REPLACE INTO offline_activity_cursor VALUES (?, ?)', [
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
      completionTime(change.kind, change.value, change.completedAt);
    }
    await this.database.transaction(async (db) => {
      const cursorRows = await db.query(
        'SELECT revision FROM offline_activity_cursor WHERE user_id = ?',
        [userId]
      );
      if (cursorRows.length !== 1) {
        throw new Error('Offline activity must be initialized before applying changes.');
      }
      const currentCursor = cursorRows[0].revision;
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
      'SELECT revision, value, completed_at FROM offline_activity_server WHERE user_id = ? AND topic_id = ? AND kind = ?',
      [userId, change.topicId, change.kind]
    );
    if (rows.length) {
      const existing = rows[0].revision;
      if (typeof existing !== 'string') throw new Error('Invalid stored activity revision.');
      if (revision(existing) === revision(change.revision)) {
        const existingTime = completionTime(change.kind, rows[0].value === 1, rows[0].completed_at);
        if (
          rows[0].value !== (change.value ? 1 : 0) ||
          !sameCompletionTime(existingTime, change.completedAt ?? null)
        ) {
          throw new Error('Conflicting offline activity revisions.');
        }
        return;
      }
      if (revision(existing) > revision(change.revision)) return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO offline_activity_server
      (user_id, topic_id, kind, value, revision, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        change.topicId,
        change.kind,
        change.value ? 1 : 0,
        change.revision,
        change.completedAt ?? null,
      ]
    );
  }

  private async refreshVisibleState(
    db: OfflineTransaction,
    userId: string,
    topicId: string,
    kind: OfflineActivityKind,
    allowMissingServer = false
  ): Promise<void> {
    const pending = await db.query(
      `SELECT value, completed_at FROM offline_activity_outbox
       WHERE user_id = ? AND topic_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1`,
      [userId, topicId, kind]
    );
    const server = pending.length
      ? pending
      : await db.query(
          'SELECT value, completed_at FROM offline_activity_server WHERE user_id = ? AND topic_id = ? AND kind = ?',
          [userId, topicId, kind]
        );
    if (!server.length && allowMissingServer) {
      await db.execute(
        'DELETE FROM offline_activity WHERE user_id = ? AND topic_id = ? AND kind = ?',
        [userId, topicId, kind]
      );
      return;
    }
    if (server.length !== 1 || (server[0].value !== 0 && server[0].value !== 1)) {
      throw new Error('Unable to reconcile offline activity state.');
    }
    const completedAt = completionTime(kind, server[0].value === 1, server[0].completed_at);
    await db.execute(
      `INSERT OR REPLACE INTO offline_activity
      (user_id, topic_id, kind, value, completed_at) VALUES (?, ?, ?, ?, ?)`,
      [userId, topicId, kind, server[0].value, completedAt]
    );
  }
}
