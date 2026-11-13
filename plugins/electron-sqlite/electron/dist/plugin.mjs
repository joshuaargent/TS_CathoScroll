import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
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
    this.openings = new Map();
  }

  assertBundled() {
    if (this.context.config.server?.url || process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL) {
      throw new Error('Offline SQLite is unavailable in the hosted desktop wrapper.');
    }
  }

  async open({ database }) {
    this.assertBundled();
    if (database !== 'catalogue' && database !== 'activity' && database !== 'private-activity') {
      throw new Error('Invalid offline database name.');
    }
    if (this.databases.has(database)) return;
    let opening = this.openings.get(database);
    if (!opening) {
      opening = this.openDatabase(database);
      this.openings.set(database, opening);
    }
    try {
      await opening;
    } finally {
      if (this.openings.get(database) === opening) this.openings.delete(database);
    }
  }

  async openDatabase(database) {
    const directory = path.join(app.getPath('userData'), 'cathoscroll-sqlite');
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
    if (database === 'private-activity') {
      const { CathoSecureStorage } = await import('./secure-storage.mjs');
      const { default: EncryptedDatabase } = await import('better-sqlite3-multiple-ciphers');
      const storage = new CathoSecureStorage(this.context);
      const keyName = 'cathoscroll.auth.v1-activity-db-key';
      const markerName = 'cathoscroll.auth.v1-activity-db-created';
      let { value: key } = await storage.get({ key: keyName });
      const { value: marker } = await storage.get({ key: markerName });
      if (marker !== null && marker !== '1') throw new Error('Invalid private database marker.');
      if (marker && !existsSync(destination)) {
        throw new Error('The saved private activity database is unavailable.');
      }
      if (key === null) {
        if (existsSync(destination)) {
          throw new Error('The private activity encryption key is unavailable.');
        }
        key = randomBytes(32).toString('base64');
        await storage.set({ key: keyName, value: key });
      }
      if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) {
        throw new Error('Invalid private activity encryption key.');
      }
      const keyBytes = Buffer.from(key, 'base64');
      if (keyBytes.length !== 32 || keyBytes.toString('base64') !== key) {
        throw new Error('Invalid private activity encryption key.');
      }
      let connection;
      try {
        connection = new EncryptedDatabase(destination);
        connection.key(keyBytes);
        connection.prepare('PRAGMA schema_version').get();
        connection.exec('PRAGMA foreign_keys = ON;');
        if (!marker) await storage.set({ key: markerName, value: '1' });
        this.databases.set(database, connection);
      } catch (error) {
        connection?.close();
        throw error;
      } finally {
        keyBytes.fill(0);
      }
    } else {
      const connection = new DatabaseSync(destination);
      connection.exec('PRAGMA foreign_keys = ON;');
      this.databases.set(database, connection);
    }
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
