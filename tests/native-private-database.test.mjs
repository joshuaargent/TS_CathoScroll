import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/native-database.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function fixture(t, options = {}) {
  const calls = [];
  const values = new Map(options.values ?? []);
  const connections = new Set();
  let secret = options.secret ?? null;
  let failOpen = options.failOpen ?? null;
  const sqlite = {
    async checkConnectionsConsistency() {
      connections.clear();
    },
    async isDatabase() {
      return { result: options.exists ?? false };
    },
    async isSecretStored() {
      return { result: secret !== null };
    },
    async checkEncryptionSecret({ passphrase }) {
      assert.equal(connections.size, 0, 'checking the secret would close active connections');
      calls.push('checkSecret');
      return { result: passphrase === secret };
    },
    async setEncryptionSecret({ passphrase }) {
      assert.equal(connections.size, 0, 'setting the secret would close active connections');
      calls.push('setSecret');
      secret = passphrase;
    },
    async createConnection(args) {
      connections.add(args.database);
      calls.push(['create', args]);
    },
    async open(args) {
      calls.push(['open', args]);
      if (args.database === failOpen) {
        failOpen = null;
        throw new Error('test open failure');
      }
    },
    async closeConnection(args) {
      connections.delete(args.database);
      calls.push(['close', args]);
    },
  };
  const plugins = {
    CathoCatalogueAsset: { async prepare() {} },
    CathoSQLite: {
      async open(args) {
        calls.push(['desktopOpen', args]);
      },
    },
  };
  const slot = `cathoscroll-test-${randomUUID()}`;
  globalThis[slot] = {
    Capacitor: { getPlatform: () => options.platform ?? 'android' },
    registerPlugin: (name) => plugins[name],
    CapacitorSQLite: sqlite,
  };
  t.after(() => {
    delete globalThis[slot];
  });
  const code = compiled
    .replace(
      "import { Capacitor, registerPlugin } from '@capacitor/core';",
      `const { Capacitor, registerPlugin } = globalThis[${JSON.stringify(slot)}];`
    )
    .replace(
      "import { CapacitorSQLite } from '@capacitor-community/sqlite';",
      `const { CapacitorSQLite } = globalThis[${JSON.stringify(slot)}];`
    );
  const databaseModule = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  const storage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
  };
  return { databaseModule, storage, sqlite, values, calls };
}

test('closes partial Android connections before retrying database startup', async (t) => {
  const { databaseModule, calls, storage } = await fixture(t, { failOpen: 'activity' });
  await assert.rejects(databaseModule.openNativeDatabases(storage), /test open failure/);
  assert.deepEqual(
    calls
      .filter((call) => Array.isArray(call) && call[0] === 'close')
      .map((call) => call[1].database),
    ['activity', 'catalogue']
  );
  await databaseModule.openNativeDatabases(storage);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'create').length, 4);
});

test('prepares Android encryption before opening public databases, including after sign-in', async (t) => {
  const { databaseModule, storage, calls } = await fixture(t);
  await databaseModule.openNativeDatabases(storage);
  const opened = calls.findIndex((call) => Array.isArray(call) && call[0] === 'create');
  assert.ok(calls.indexOf('setSecret') < opened);
  await databaseModule.openPrivateActivityDatabase(storage);
  assert.equal(calls.filter((call) => call === 'setSecret').length, 1);
  assert.equal(calls.filter((call) => call === 'checkSecret').length, 0);

  const existing = await fixture(t, {
    secret: 'a'.repeat(64),
    values: [['cathoscroll.auth.v1-activity-db-key', 'a'.repeat(64)]],
  });
  await existing.databaseModule.openNativeDatabases(existing.storage);
  assert.ok(
    existing.calls.indexOf('checkSecret') <
      existing.calls.findIndex((call) => Array.isArray(call) && call[0] === 'create')
  );
  await existing.databaseModule.openPrivateActivityDatabase(existing.storage);
  assert.equal(existing.calls.filter((call) => call === 'checkSecret').length, 1);
});

test('creates an encrypted Android activity connection once and protects its key', async (t) => {
  const { databaseModule, storage, values, calls } = await fixture(t);
  const [first, second] = await Promise.all([
    databaseModule.openPrivateActivityDatabase(storage),
    databaseModule.openPrivateActivityDatabase(storage),
  ]);
  assert.equal(first, second);
  assert.match(values.get('cathoscroll.auth.v1-activity-db-key'), /^[a-f0-9]{64}$/);
  assert.equal(values.get('cathoscroll.auth.v1-activity-db-created'), '1');
  assert.equal(calls.filter((call) => call === 'setSecret').length, 1);
  const privateConnections = calls.filter(
    (call) => Array.isArray(call) && call[0] === 'create' && call[1].database === 'private-activity'
  );
  assert.deepEqual(
    privateConnections.map((call) => call[1]),
    [
      {
        database: 'private-activity',
        version: 1,
        encrypted: true,
        mode: 'secret',
        readonly: false,
      },
    ]
  );
});

test('opens the separate private desktop database through the native bridge', async (t) => {
  const { databaseModule, storage, calls } = await fixture(t, { platform: 'electron' });
  await databaseModule.openPrivateActivityDatabase(storage);
  assert.deepEqual(
    calls
      .filter((call) => Array.isArray(call) && call[0] === 'desktopOpen')
      .map((call) => call[1].database),
    ['catalogue', 'activity', 'private-activity']
  );
});

test('does not replace missing or mismatched private activity keys', async (t) => {
  const missing = await fixture(t, { exists: true });
  await assert.rejects(
    missing.databaseModule.openPrivateActivityDatabase(missing.storage),
    /key is unavailable/
  );
  assert.equal(missing.calls.includes('setSecret'), false);

  const wrong = await fixture(t, {
    exists: true,
    secret: 'b'.repeat(64),
    values: [['cathoscroll.auth.v1-activity-db-key', 'a'.repeat(64)]],
  });
  await assert.rejects(
    wrong.databaseModule.openPrivateActivityDatabase(wrong.storage),
    /does not match/
  );
  assert.equal(
    wrong.calls.some((call) => Array.isArray(call) && call[1].database === 'private-activity'),
    false
  );
});

test('does not recreate a private database that has disappeared', async (t) => {
  const fixtureResult = await fixture(t, {
    values: [
      ['cathoscroll.auth.v1-activity-db-key', 'a'.repeat(64)],
      ['cathoscroll.auth.v1-activity-db-created', '1'],
    ],
  });
  await assert.rejects(
    fixtureResult.databaseModule.openPrivateActivityDatabase(fixtureResult.storage),
    /database is unavailable/
  );
  assert.equal(fixtureResult.calls.includes('setSecret'), false);
});
