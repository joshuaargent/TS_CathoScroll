import { Capacitor, registerPlugin } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import type { OfflineDatabase, OfflineTransaction } from './activity-store';

type DatabaseName = 'catalogue' | 'activity';
type Value = string | number | null;
type QueryOptions = { database: DatabaseName; statement: string; values: Value[] };

interface DesktopSQLite {
  open(options: { database: DatabaseName }): Promise<void>;
  execute(options: QueryOptions): Promise<void>;
  query(options: QueryOptions): Promise<{ rows: Record<string, unknown>[] }>;
  begin(options: { database: DatabaseName }): Promise<void>;
  commit(options: { database: DatabaseName }): Promise<void>;
  rollback(options: { database: DatabaseName }): Promise<void>;
}

const desktop = registerPlugin<DesktopSQLite>('CathoSQLite');
const androidCatalogueAsset = registerPlugin<{ prepare(): Promise<void> }>('CathoCatalogueAsset');

interface Connection {
  execute(statement: string, values: Value[]): Promise<void>;
  query(statement: string, values: Value[]): Promise<Record<string, unknown>[]>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

class NativeDatabase implements OfflineDatabase {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly connection: Connection) {}

  transaction<T>(callback: (database: OfflineTransaction) => Promise<T>): Promise<T> {
    const current = this.tail.then(async () => {
      await this.connection.begin();
      try {
        const result = await callback({
          execute: (statement, values = []) => this.connection.execute(statement, values),
          query: (statement, values = []) => this.connection.query(statement, values),
        });
        await this.connection.commit();
        return result;
      } catch (error) {
        try {
          await this.connection.rollback();
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Offline database rollback failed.');
        }
        throw error;
      }
    });
    this.tail = current.then(
      () => undefined,
      () => undefined
    );
    return current;
  }
}

function desktopConnection(database: DatabaseName): Connection {
  return {
    execute: (statement, values) => desktop.execute({ database, statement, values }),
    async query(statement, values) {
      const { rows } = await desktop.query({ database, statement, values });
      if (!Array.isArray(rows)) throw new Error('Invalid SQLite query response.');
      return rows;
    },
    begin: () => desktop.begin({ database }),
    commit: () => desktop.commit({ database }),
    rollback: () => desktop.rollback({ database }),
  };
}

function mobileConnection(database: DatabaseName): Connection {
  return {
    async execute(statement, values) {
      const result =
        values.length === 0
          ? await CapacitorSQLite.execute({ database, statements: statement, transaction: false })
          : await CapacitorSQLite.run({ database, statement, values, transaction: false });
      if (result.changes?.changes === -1) throw new Error('SQLite statement failed.');
    },
    async query(statement, values) {
      const result = await CapacitorSQLite.query({ database, statement, values });
      if (!Array.isArray(result.values)) throw new Error('Invalid SQLite query response.');
      return result.values;
    },
    async begin() {
      await CapacitorSQLite.beginTransaction({ database });
    },
    async commit() {
      await CapacitorSQLite.commitTransaction({ database });
    },
    async rollback() {
      await CapacitorSQLite.rollbackTransaction({ database });
    },
  };
}

export interface NativeDatabases {
  catalogue: OfflineDatabase;
  activity: OfflineDatabase;
}

let opening: Promise<NativeDatabases> | undefined;

export function openNativeDatabases(): Promise<NativeDatabases> {
  if (!opening) {
    opening = initializeNativeDatabases().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

async function initializeNativeDatabases(): Promise<NativeDatabases> {
  const platform = Capacitor.getPlatform();
  if (platform === 'electron') {
    await desktop.open({ database: 'catalogue' });
    await desktop.open({ database: 'activity' });
    return {
      catalogue: new NativeDatabase(desktopConnection('catalogue')),
      activity: new NativeDatabase(desktopConnection('activity')),
    };
  }
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('Offline SQLite is available only in the native apps.');
  }
  await CapacitorSQLite.checkConnectionsConsistency({ dbNames: [], openModes: [] });
  if (platform === 'android') {
    await androidCatalogueAsset.prepare();
  } else {
    await CapacitorSQLite.copyFromAssets({ overwrite: false });
  }
  for (const database of ['catalogue', 'activity'] as const) {
    await CapacitorSQLite.createConnection({
      database,
      version: 1,
      encrypted: false,
      mode: 'no-encryption',
      readonly: false,
    });
    await CapacitorSQLite.open({ database });
  }
  return {
    catalogue: new NativeDatabase(mobileConnection('catalogue')),
    activity: new NativeDatabase(mobileConnection('activity')),
  };
}
