import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-secure-storage-'));
  t.after(() => rm(directory, { recursive: true }));
  const source = await readFile(
    new URL('../plugins/electron-sqlite/electron/dist/secure-storage.mjs', import.meta.url),
    'utf8'
  );
  const electronImport = "import { app, safeStorage } from 'electron';";
  assert.ok(source.includes(electronImport));
  const script = source.replace(
    electronImport,
    `const app = { getPath: () => ${JSON.stringify(directory)} };
     const safeStorage = {
       isEncryptionAvailable: () => ${JSON.stringify(options.available !== false)},
       getSelectedStorageBackend: () => 'gnome_libsecret',
       encryptString: value => Buffer.from('encrypted:' + value.split('').reverse().join('')),
       decryptString: value => {
         const text = value.toString();
         if (!text.startsWith('encrypted:')) throw new Error('Invalid ciphertext');
         return text.slice(10).split('').reverse().join('');
       }
     };`
  );
  const { CathoSecureStorage } = await import(
    `data:text/javascript;base64,${Buffer.from(script).toString('base64')}`
  );
  const context = { config: options.hosted ? { server: { url: 'https://example.test' } } : {} };
  return { storage: new CathoSecureStorage(context), context, directory };
}

test('stores encrypted session values across instances and removes them', async (t) => {
  const { storage, directory } = await fixture(t);
  const key = 'cathoscroll.auth.v1';
  assert.deepEqual(await storage.get({ key }), { value: null });
  await storage.set({ key, value: 'session secret' });
  const files = await readdir(path.join(directory, 'secure-auth'));
  assert.equal(files.length, 1);
  assert.ok(
    !(await readFile(path.join(directory, 'secure-auth', files[0]), 'utf8')).includes(
      'session secret'
    )
  );
  const reopened = new storage.constructor(storage.context);
  assert.deepEqual(await reopened.get({ key }), { value: 'session secret' });
  await reopened.set({ key, value: 'refreshed token' });
  assert.deepEqual(await storage.get({ key }), { value: 'refreshed token' });
  await reopened.remove({ key });
  assert.deepEqual(await storage.get({ key }), { value: null });
});

test('rejects hosted wrappers, unavailable encryption, invalid keys and corrupt data', async (t) => {
  const key = 'cathoscroll.auth.v1';
  const hosted = await fixture(t, { hosted: true });
  await assert.rejects(hosted.storage.get({ key }), /hosted/);
  const unavailable = await fixture(t, { available: false });
  await assert.rejects(unavailable.storage.set({ key, value: 'secret' }), /unavailable/);
  const { storage, directory } = await fixture(t);
  await assert.rejects(storage.set({ key: '../other', value: 'secret' }), /Invalid/);
  await storage.set({ key, value: 'secret' });
  const [file] = await readdir(path.join(directory, 'secure-auth'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(directory, 'secure-auth', file), 'corrupt');
  await assert.rejects(storage.get({ key }), /Invalid ciphertext/);
});

test('a configured Electron development server cannot access secure storage', async (t) => {
  const { storage } = await fixture(t);
  const previous = process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL;
  process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL = 'http://localhost:3000';
  try {
    await assert.rejects(storage.get({ key: 'cathoscroll.auth.v1' }), /hosted/);
  } finally {
    if (previous === undefined) delete process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL;
    else process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL = previous;
  }
});
