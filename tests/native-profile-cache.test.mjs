import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/profile-cache.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { NativeProfileCache } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('caches profile fields by account and rejects invalid replacements', async () => {
  const db = new DatabaseSync(':memory:');
  const cache = new NativeProfileCache({
    async transaction(callback) {
      db.exec('BEGIN');
      try {
        const result = await callback({
          async execute(statement, values = []) {
            db.prepare(statement).run(...values);
          },
          async query(statement, values = []) {
            return db.prepare(statement).all(...values);
          },
        });
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  });
  try {
    await cache.initialize();
    const alice = { username: 'alice', displayName: 'Alice', bio: 'A bio' };
    await cache.save('alice-id', alice);
    await cache.save('bob-id', { username: 'bob', displayName: 'Bob', bio: '' });
    assert.deepEqual(await cache.load('alice-id'), alice);
    assert.equal(await cache.load('unknown-id'), null);
    await assert.rejects(cache.save('alice-id', { ...alice, bio: null }), /Invalid/);
    assert.deepEqual(await cache.load('alice-id'), alice);
  } finally {
    db.close();
  }
});
