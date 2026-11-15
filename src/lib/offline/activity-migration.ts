import type { OfflineDatabase, OfflineTransaction } from './activity-store';

const tables = [
  {
    name: 'offline_activity',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'completed_at'],
    optionalColumns: ['bookmark_saved_at'],
  },
  {
    name: 'offline_activity_outbox',
    columns: ['sequence', 'operation_id', 'user_id', 'topic_id', 'kind', 'value', 'completed_at'],
  },
  {
    name: 'offline_activity_rejections',
    columns: [
      'operation_id',
      'user_id',
      'topic_id',
      'kind',
      'value',
      'completed_at',
      'reason',
      'notified',
    ],
  },
  {
    name: 'offline_activity_server',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'revision', 'completed_at'],
  },
  { name: 'offline_activity_cursor', columns: ['user_id', 'revision'] },
  {
    name: 'offline_activity_bootstrap',
    columns: ['user_id', 'snapshot_id', 'revision', 'base_cursor'],
  },
  {
    name: 'offline_activity_bootstrap_items',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'completed_at'],
  },
  {
    name: 'offline_comment_cache',
    columns: ['topic_id', 'comments', 'saved_at'],
    optional: true,
  },
  {
    name: 'offline_topic_counts',
    columns: ['topic_id', 'likes', 'comments', 'saved_at'],
    optional: true,
  },
  {
    name: 'offline_private_notes',
    columns: ['note_key', 'nonce', 'ciphertext'],
    optional: true,
  },
] as const;

type Value = string | number | null;

async function copyTable(
  source: OfflineTransaction,
  destination: OfflineTransaction,
  table: (typeof tables)[number],
  merge = false
) {
  const schema = await source.query(`PRAGMA table_info(${table.name})`);
  const names = schema.map((column) => column.name);
  if (names.length === 0 && 'optional' in table && table.optional) return;
  const optionalColumns = 'optionalColumns' in table ? table.optionalColumns : [];
  const presentOptionalColumns = optionalColumns.filter((column) => names.includes(column));
  const allowedColumns = [...table.columns, ...optionalColumns];
  if (
    names.length !== table.columns.length + presentOptionalColumns.length ||
    table.columns.some((column) => !names.includes(column)) ||
    names.some((name) => typeof name !== 'string' ||
      !allowedColumns.includes(name as (typeof allowedColumns)[number]))
  ) {
    throw new Error(`Unexpected legacy activity schema in ${table.name}.`);
  }
  const copiedColumns = [...table.columns, ...presentOptionalColumns];
  const columns = copiedColumns.join(', ');
  const placeholders = copiedColumns.map(() => '?').join(', ');
  let offset = 0;
  for (;;) {
    const rows = await source.query(
      `SELECT ${columns} FROM ${table.name} ORDER BY rowid LIMIT 250 OFFSET ?`,
      [offset]
    );
    for (const row of rows) {
      const values: Value[] = copiedColumns.map((column) => {
        const value = row[column];
        if (
          value !== null &&
          typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isSafeInteger(value))
        ) {
          throw new Error(`Invalid legacy activity value in ${table.name}.`);
        }
        return value;
      });
      await destination.execute(
        `${merge ? 'INSERT OR IGNORE' : 'INSERT'} INTO ${table.name} (${columns}) VALUES (${placeholders})`,
        values
      );
    }
    offset += rows.length;
    if (rows.length < 250) break;
  }
}

/**
 * Both stores must be initialized and the legacy store must not be used for new activity.
 * Activity plus cached comments, counts and encrypted notes are copied transactionally.
 * The caller verifies the encrypted database before removing the legacy database.
 */
export async function migrateLegacyActivity(
  legacy: OfflineDatabase,
  privateDatabase: OfflineDatabase
): Promise<void> {
  if (legacy === privateDatabase) throw new Error('Activity databases must be separate.');
  await legacy.transaction(async (source) => {
    await privateDatabase.transaction(async (destination) => {
      await destination.execute(`
        CREATE TABLE IF NOT EXISTS offline_activity_migration (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        )
      `);
      await destination.execute(`CREATE TABLE IF NOT EXISTS offline_comment_cache (
        topic_id TEXT PRIMARY KEY NOT NULL,
        comments TEXT NOT NULL,
        saved_at TEXT NOT NULL
      )`);
      await destination.execute(`CREATE TABLE IF NOT EXISTS offline_topic_counts (
        topic_id TEXT PRIMARY KEY NOT NULL,
        likes INTEGER NOT NULL CHECK (likes >= 0),
        comments INTEGER NOT NULL CHECK (comments >= 0),
        saved_at TEXT NOT NULL
      )`);
      await destination.execute(`CREATE TABLE IF NOT EXISTS offline_private_notes (
        note_key TEXT PRIMARY KEY NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL
      )`);
      const marker = await destination.query('SELECT id, version FROM offline_activity_migration');
      if (marker.length) {
        if (marker.length !== 1 || marker[0].id !== 1 || marker[0].version !== 1) {
          throw new Error('Invalid offline activity migration marker.');
        }
        // Older app versions continued storing comment, count and encrypted
        // note caches in the plaintext database after activity had migrated.
        // Merge those optional cache tables on every startup until cleanup
        // succeeds; existing encrypted destination rows are never overwritten.
        for (const table of tables) {
          if ('optional' in table && table.optional) {
            await copyTable(source, destination, table, true);
          }
        }
        return;
      }
      for (const table of tables) {
        const rows = await destination.query(`SELECT 1 AS present FROM ${table.name} LIMIT 1`);
        if (rows.length) throw new Error('Private activity exists without a migration marker.');
      }
      for (const table of tables) await copyTable(source, destination, table);
      await destination.execute(
        'INSERT INTO offline_activity_migration (id, version) VALUES (1, 1)'
      );
    });
  });
}
