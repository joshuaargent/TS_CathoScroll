import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
      electronImport,
      `const app = {
      getPath: () => ${JSON.stringify(userData)},
      getAppPath: () => ${JSON.stringify(directory)}
    };`
    );
  const { CathoSQLite } = await import(
    `data:text/javascript;base64,${Buffer.from(script).toString('base64')}`
  );
  plugin = new CathoSQLite({
    config: server ? { server: { url: server } } : {},
    services: { bundles: { getActiveBundlePath: () => bundle } },
  });
  return { plugin, userData };
}

test('hosted desktop pages cannot open or query the offline databases', async (t) => {
  const { plugin, userData } = await fixture(t, 'https://cathoscroll.vercel.app');
  await assert.rejects(plugin.open({ database: 'catalogue' }), /hosted desktop wrapper/);
  await assert.rejects(plugin.open({ database: 'activity' }), /hosted desktop wrapper/);
  await assert.rejects(
    plugin.query({ database: 'activity', statement: 'SELECT 1' }),
    /hosted desktop wrapper/
  );
  await assert.rejects(readFile(path.join(userData, 'databases', 'activity.sqlite')), {
    code: 'ENOENT',
  });
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
