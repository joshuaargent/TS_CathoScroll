import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/topic-count-cache.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OfflineTopicCountCache } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('stores per-topic counts and preserves the last good values after an invalid update', async () => {
  const db = new DatabaseSync(':memory:');
  const adapter = {
    async transaction(callback) {
      return callback({
        async execute(sql, values = []) {
          db.prepare(sql).run(...values);
        },
        async query(sql, values = []) {
          return db.prepare(sql).all(...values);
        },
      });
    },
  };
  try {
    const cache = new OfflineTopicCountCache(adapter);
    await cache.initialize();
    assert.equal(await cache.load('topic'), null);
    const saved = await cache.save('topic', 0, 42);
    assert.deepEqual(await cache.load('topic'), saved);
    assert.equal(await cache.load('other'), null);
    await assert.rejects(cache.save('topic', -1, 0), /Invalid topic counts/);
    assert.deepEqual(await cache.load('topic'), saved);
  } finally {
    db.close();
  }
});
