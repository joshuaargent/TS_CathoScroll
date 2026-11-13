import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

async function fixture(t, server) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-electron-sqlite-'));
  let plugin;
  t.after(async () => {
    if (plugin) {
      for (const connection of plugin.databases.values()) connection.close();
    }
    await rm(directory, { recursive: true });
  });
  const bundle = path.join(directory, 'bundle');
  const userData = path.join(directory, 'user-data');
  const assets = path.join(bundle, 'assets', 'databases');
  await mkdir(assets, { recursive: true });
  const catalogue = new DatabaseSync(path.join(assets, 'catalogue.db'));
  catalogue.exec("CREATE TABLE topics (id TEXT); INSERT INTO topics VALUES ('bundled');");
  catalogue.close();

  const source = await readFile(
    new URL('../plugins/electron-sqlite/electron/dist/plugin.mjs', import.meta.url),
    'utf8'
  );
  const electronImport = "import { app } from 'electron';";
  assert.ok(source.includes(electronImport));
  const script = source
    .replace("export { CathoSecureStorage } from './secure-storage.mjs';", '')
    .replace(
      "await import('./secure-storage.mjs')",
      `await Promise.resolve({ CathoSecureStorage: class {
        async get({ key }) { return { value: testVault.get(key) ?? null }; }
        async set({ key, value }) { testVault.set(key, value); }
      } })`
    )
    .replace(
      "import('better-sqlite3-multiple-ciphers')",
      `import(${JSON.stringify(
        pathToFileURL(createRequire(import.meta.url).resolve('better-sqlite3-multiple-ciphers'))
          .href
      )})`
    )
    .replace(
      electronImport,
      `const app = {
      getPath: () => ${JSON.stringify(userData)},
      getAppPath: () => ${JSON.stringify(directory)}
    };`
    );
  const { CathoSQLite, testVault } = await import(
    `data:text/javascript;base64,${Buffer.from(`export const testVault = new Map();\n${script}`).toString('base64')}`
  );
  plugin = new CathoSQLite({
    config: server ? { server: { url: server } } : {},
    services: { bundles: { getActiveBundlePath: () => bundle } },
  });
  return { plugin, userData, testVault };
}

test('hosted desktop pages cannot open or query the offline databases', async (t) => {
  const { plugin, userData } = await fixture(t, 'https://cathoscroll.vercel.app');
  await assert.rejects(plugin.open({ database: 'catalogue' }), /hosted desktop wrapper/);
  await assert.rejects(plugin.open({ database: 'activity' }), /hosted desktop wrapper/);
  await assert.rejects(plugin.open({ database: 'private-activity' }), /hosted desktop wrapper/);
  await assert.rejects(
    plugin.query({ database: 'activity', statement: 'SELECT 1' }),
    /hosted desktop wrapper/
  );
  await assert.rejects(readFile(path.join(userData, 'cathoscroll-sqlite', 'activity.sqlite')), {
    code: 'ENOENT',
  });
});

test('encrypts private activity, survives restart, and refuses missing keys', async (t) => {
  const { plugin, userData, testVault } = await fixture(t);
  await Promise.all([
    plugin.open({ database: 'private-activity' }),
    plugin.open({ database: 'private-activity' }),
  ]);
  await plugin.execute({
    database: 'private-activity',
    statement: 'CREATE TABLE entries (value TEXT NOT NULL)',
  });
  await plugin.execute({
    database: 'private-activity',
    statement: 'INSERT INTO entries VALUES (?)',
    values: ['synthetic private activity'],
  });
  const filename = path.join(userData, 'cathoscroll-sqlite', 'private-activity.sqlite');
  const file = await readFile(filename);
  assert.equal(file.includes(Buffer.from('synthetic private activity')), false);
  assert.notEqual(file.subarray(0, 16).toString('ascii'), 'SQLite format 3\0');
  plugin.databases.get('private-activity').close();
  plugin.databases.delete('private-activity');
  await plugin.open({ database: 'private-activity' });
  assert.deepEqual(
    await plugin.query({ database: 'private-activity', statement: 'SELECT value FROM entries' }),
    { rows: [{ value: 'synthetic private activity' }] }
  );
  plugin.databases.get('private-activity').close();
  plugin.databases.delete('private-activity');
  const key = testVault.get('cathoscroll.auth.v1-activity-db-key');
  testVault.delete('cathoscroll.auth.v1-activity-db-key');
  await assert.rejects(plugin.open({ database: 'private-activity' }), /key is unavailable/);
  assert.deepEqual(await readFile(filename), file);
  testVault.set('cathoscroll.auth.v1-activity-db-key', Buffer.alloc(32, 1).toString('base64'));
  await assert.rejects(plugin.open({ database: 'private-activity' }), /encrypted|not a database/i);
  assert.deepEqual(await readFile(filename), file);
  testVault.set('cathoscroll.auth.v1-activity-db-key', key);
  await unlink(filename);
  await assert.rejects(plugin.open({ database: 'private-activity' }), /database is unavailable/);
});

test('a configured Electron development server cannot use the offline database bridge', async (t) => {
  const { plugin } = await fixture(t);
  const previous = process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL;
  process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL = 'http://localhost:3000';
  try {
    await assert.rejects(plugin.open({ database: 'activity' }), /hosted desktop wrapper/);
  } finally {
    if (previous === undefined) delete process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL;
    else process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL = previous;
  }
});

test('bundled desktop app can use its catalogue and transactional activity database', async (t) => {
  const { plugin } = await fixture(t);
  await plugin.open({ database: 'catalogue' });
  await plugin.open({ database: 'activity' });
  assert.deepEqual(
    await plugin.query({ database: 'catalogue', statement: 'SELECT id FROM topics' }),
    {
      rows: [{ id: 'bundled' }],
    }
  );

  await plugin.execute({
    database: 'activity',
    statement: 'CREATE TABLE entries (id TEXT)',
  });
  await plugin.begin({ database: 'activity' });
  await plugin.execute({
    database: 'activity',
    statement: 'INSERT INTO entries VALUES (?)',
    values: ['saved'],
  });
  await plugin.commit({ database: 'activity' });
  await plugin.begin({ database: 'activity' });
  await plugin.execute({
    database: 'activity',
    statement: 'INSERT INTO entries VALUES (?)',
    values: ['rolled back'],
  });
  await plugin.rollback({ database: 'activity' });
  assert.deepEqual(
    await plugin.query({ database: 'activity', statement: 'SELECT id FROM entries' }),
    {
      rows: [{ id: 'saved' }],
    }
  );
});
