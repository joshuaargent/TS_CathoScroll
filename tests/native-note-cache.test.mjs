import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/note-cache.ts', import.meta.url), 'utf8');
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(
    "import { authStorageKey } from './secure-auth-storage';",
    "const authStorageKey = 'cathoscroll.auth.v1';"
  );
const { NativeNoteCache } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  const secrets = new Map();
  let tail = Promise.resolve();
  const database = {
    transaction(callback) {
      const current = tail.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const value = await callback({
            async execute(sql, values = []) {
              db.prepare(sql).run(...values);
            },
            async query(sql, values = []) {
              return db.prepare(sql).all(...values);
            },
          });
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      tail = current.then(
        () => undefined,
        () => undefined
      );
      return current;
    },
  };
  const storage = {
    async getItem(key) {
      return secrets.get(key) ?? null;
    },
    async setItem(key, value) {
      secrets.set(key, value);
    },
  };
  return { db, secrets, database, storage, cache: new NativeNoteCache(database, storage) };
}

test('encrypts account-scoped notes and restores them using the protected key', async () => {
  const { db, database, storage, cache } = fixture();
  try {
    await cache.initialize();
    await cache.save('account-one', 'topic-one', 'Private note text');
    await cache.save('account-two', 'topic-one', 'Another account note');
    await cache.save('account-one', 'topic-two', null);
    const restored = new NativeNoteCache(database, storage);
    assert.equal((await restored.load('account-one', 'topic-one')).content, 'Private note text');
    assert.equal((await restored.load('account-two', 'topic-one')).content, 'Another account note');
    assert.equal((await restored.load('account-one', 'topic-two')).content, null);
    assert.equal(await restored.load('account-two', 'topic-two'), null);
    const rows = JSON.stringify(db.prepare('SELECT * FROM offline_private_notes').all());
    for (const secret of ['account-one', 'account-two', 'topic-one', 'Private note text']) {
      assert.equal(rows.includes(secret), false);
    }
  } finally {
    db.close();
  }
});

test('does not replace a missing key or overwrite unreadable cached notes', async () => {
  const { db, secrets, database, storage, cache } = fixture();
  try {
    await cache.initialize();
    await cache.save('account', 'topic', 'original');
    const before = db.prepare('SELECT * FROM offline_private_notes').get();
    secrets.clear();
    const restored = new NativeNoteCache(database, storage);
    await assert.rejects(restored.load('account', 'topic'), /encryption key is unavailable/);
    await assert.rejects(
      restored.save('account', 'topic', 'replacement'),
      /encryption key is unavailable/
    );
    assert.deepEqual(db.prepare('SELECT * FROM offline_private_notes').get(), before);
    assert.equal(secrets.size, 0);
  } finally {
    db.close();
  }
});

test('rejects modified ciphertext and coalesces concurrent initial key creation', async () => {
  const { db, secrets, cache } = fixture();
  try {
    await cache.initialize();
    await Promise.all([cache.load('account', 'one'), cache.load('account', 'two')]);
    assert.equal(secrets.size, 1);
    await cache.save('account', 'topic', 'original');
    const row = db.prepare('SELECT ciphertext FROM offline_private_notes').get();
    const altered = Buffer.from(row.ciphertext, 'base64');
    altered[0] ^= 1;
    db.prepare('UPDATE offline_private_notes SET ciphertext = ?').run(altered.toString('base64'));
    await assert.rejects(cache.load('account', 'topic'));
    await assert.rejects(cache.save('account', 'topic', 'replacement'));
    assert.equal(
      db.prepare('SELECT ciphertext FROM offline_private_notes').get().ciphertext,
      altered.toString('base64')
    );
  } finally {
    db.close();
  }
});
