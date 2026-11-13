import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';

export { CathoSecureStorage } from './secure-storage.mjs';

export class CathoSQLite {
  static __capacitorElectronPlugin = {
    name: 'CathoSQLite',
    methods: ['open', 'execute', 'query', 'begin', 'commit', 'rollback'],
  };

  constructor(context) {
    this.context = context;
    this.databases = new Map();
  }

  assertBundled() {
    if (this.context.config.server?.url || process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL) {
      throw new Error('Offline SQLite is unavailable in the hosted desktop wrapper.');
    }
  }

  async open({ database }) {
    this.assertBundled();
    if (database !== 'catalogue' && database !== 'activity') {
      throw new Error('Invalid offline database name.');
    }
    if (this.databases.has(database)) return;

    const directory = path.join(app.getPath('userData'), 'databases');
    mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${database}.sqlite`);
    if (database === 'catalogue' && !existsSync(destination)) {
      const bundle =
        this.context.services.bundles.getActiveBundlePath() ?? path.join(app.getAppPath(), 'app');
      const source = path.join(bundle, 'assets', 'databases', 'catalogue.db');
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        copyFileSync(source, temporary);
        renameSync(temporary, destination);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    const connection = new DatabaseSync(destination);
    connection.exec('PRAGMA foreign_keys = ON;');
    this.databases.set(database, connection);
  }

  connection(database) {
    this.assertBundled();
    const connection = this.databases.get(database);
    if (!connection) throw new Error('Offline database is not open.');
    return connection;
  }

  async execute({ database, statement, values = [] }) {
    this.connection(database)
      .prepare(statement)
      .run(...values);
  }

  async query({ database, statement, values = [] }) {
    const rows = this.connection(database)
      .prepare(statement)
      .all(...values);
    return { rows: rows.map((row) => ({ ...row })) };
  }

  async begin({ database }) {
    this.connection(database).exec('BEGIN IMMEDIATE');
  }

  async commit({ database }) {
    this.connection(database).exec('COMMIT');
  }

  async rollback({ database }) {
    this.connection(database).exec('ROLLBACK');
  }
}
