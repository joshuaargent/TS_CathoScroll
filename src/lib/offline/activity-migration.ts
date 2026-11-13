import type { OfflineDatabase, OfflineTransaction } from './activity-store';

const tables = [
  {
    name: 'offline_activity',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'completed_at'],
  },
  {
    name: 'offline_activity_outbox',
    columns: ['sequence', 'operation_id', 'user_id', 'topic_id', 'kind', 'value', 'completed_at'],
  },
  {
    name: 'offline_activity_server',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'revision', 'completed_at'],
  },
  { name: 'offline_activity_cursor', columns: ['user_id', 'revision'] },
  { name: 'offline_activity_bootstrap', columns: ['user_id', 'snapshot_id', 'revision'] },
  {
    name: 'offline_activity_bootstrap_items',
    columns: ['user_id', 'topic_id', 'kind', 'value', 'completed_at'],
  },
] as const;

type Value = string | number | null;

async function copyTable(
  source: OfflineTransaction,
  destination: OfflineTransaction,
  table: (typeof tables)[number]
) {
  const schema = await source.query(`PRAGMA table_info(${table.name})`);
  const names = schema.map((column) => column.name);
  if (
    names.length !== table.columns.length ||
    table.columns.some((column) => !names.includes(column))
  ) {
    throw new Error(`Unexpected legacy activity schema in ${table.name}.`);
  }
  const columns = table.columns.join(', ');
  const placeholders = table.columns.map(() => '?').join(', ');
  let offset = 0;
  for (;;) {
    const rows = await source.query(
      `SELECT ${columns} FROM ${table.name} ORDER BY rowid LIMIT 250 OFFSET ?`,
      [offset]
    );
    for (const row of rows) {
      const values: Value[] = table.columns.map((column) => {
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
        `INSERT INTO ${table.name} (${columns}) VALUES (${placeholders})`,
        values
      );
    }
    offset += rows.length;
    if (rows.length < 250) break;
  }
}

/**
 * Both stores must be initialized and the legacy store must not be used for new activity.
 * The legacy copy is retained; no data is deleted if the transfer is interrupted.
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
      const marker = await destination.query('SELECT id, version FROM offline_activity_migration');
      if (marker.length) {
        if (marker.length !== 1 || marker[0].id !== 1 || marker[0].version !== 1) {
          throw new Error('Invalid offline activity migration marker.');
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
