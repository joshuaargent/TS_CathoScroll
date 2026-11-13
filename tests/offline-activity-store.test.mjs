import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/activity-store.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OfflineActivityStore } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const syncSource = await readFile(
  new URL('../src/lib/offline/activity-sync.ts', import.meta.url),
  'utf8'
);
const syncCompiled = ts.transpileModule(syncSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OfflineActivitySync } = await import(
  `data:text/javascript;base64,${Buffer.from(syncCompiled).toString('base64')}`
);

function adapter(db) {
  let tail = Promise.resolve();
  return {
    transaction(callback) {
      const current = tail.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await callback({
            async execute(sql, values = []) {
              db.prepare(sql).run(...values);
            },
            async query(sql, values = []) {
              return db.prepare(sql).all(...values);
            },
          });
          db.exec('COMMIT');
          return result;
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
}

async function databaseFile(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-activity-'));
  const file = path.join(directory, 'activity.sqlite');
  t.after(async () => {
    await unlink(file);
    await rmdir(directory);
  });
  return file;
}

test('persists account-scoped activity and ordered operations across restarts', async (t) => {
  const file = await databaseFile(t);
  let db = new DatabaseSync(file);
  let store = new OfflineActivityStore(adapter(db));
  await store.initialize();
  await store.setActivity('alice', 'topic', 'bookmark', true, 'operation-1');
  await store.setActivity('bob', 'topic', 'bookmark', true, 'operation-2');
  await store.setActivity('alice', 'topic', 'bookmark', false, 'operation-3');
  db.close();

  db = new DatabaseSync(file);
  store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    assert.equal(await store.getActivity('alice', 'topic', 'bookmark'), false);
    assert.equal(await store.getActivity('bob', 'topic', 'bookmark'), true);
    assert.equal(await store.getActivity('alice', 'other', 'bookmark'), null);
    assert.equal((await store.nextOperation('alice')).operationId, 'operation-1');
    assert.equal((await store.nextOperation('bob')).operationId, 'operation-2');
    await assert.rejects(store.acknowledge('alice', 'operation-3'), /first pending/);
    await assert.rejects(store.acknowledge('bob', 'operation-1'), /first pending/);
    await store.acknowledge('alice', 'operation-1');
    assert.equal((await store.nextOperation('alice')).operationId, 'operation-3');
    assert.equal((await store.nextOperation('bob')).operationId, 'operation-2');
  } finally {
    db.close();
  }
});

test('rolls back the visible state if queue insertion fails', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.setActivity('alice', 'topic', 'like', true, 'duplicate');
    await assert.rejects(store.setActivity('alice', 'topic', 'like', false, 'duplicate'));
    assert.equal(await store.getActivity('alice', 'topic', 'like'), true);
    assert.equal((await store.nextOperation('alice')).value, true);
  } finally {
    db.close();
  }
});

test('retries the same operation after a lost response and preserves account order', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.setActivity('alice', 'topic', 'like', true, 'first');
    await store.setActivity('alice', 'topic', 'like', false, 'second');
    await store.setActivity('bob', 'topic', 'like', true, 'other');
    const sent = [];
    let lostResponse = true;
    const sync = new OfflineActivitySync(store, async (operation) => {
      sent.push(operation.operationId);
      if (lostResponse) {
        lostResponse = false;
        throw new Error('Connection lost');
      }
      return { operationId: operation.operationId, userId: operation.userId };
    });

    await assert.rejects(sync.push('alice'), /Connection lost/);
    assert.equal((await store.nextOperation('alice')).operationId, 'first');
    assert.equal(await sync.push('alice'), 2);
    assert.deepEqual(sent, ['first', 'first', 'second']);
    assert.equal(await store.nextOperation('alice'), null);
    assert.equal((await store.nextOperation('bob')).operationId, 'other');
  } finally {
    db.close();
  }
});

test('does not acknowledge a mismatched receipt or run concurrent pushes', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.setActivity('alice', 'topic', 'bookmark', true, 'first');
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const sync = new OfflineActivitySync(store, async () => {
      await wait;
      return { operationId: 'first', userId: 'bob' };
    });
    const running = sync.push('alice');
    await assert.rejects(sync.push('bob'), /already running/);
    release();
    await assert.rejects(running, /mismatched/);
    assert.equal((await store.nextOperation('alice')).operationId, 'first');
  } finally {
    db.close();
  }
});
