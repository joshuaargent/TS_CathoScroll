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
const backgroundSource = await readFile(
  new URL('../src/lib/offline/activity-background-sync.ts', import.meta.url),
  'utf8'
);
const backgroundCompiled = ts.transpileModule(backgroundSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { BackgroundActivitySync } = await import(
  `data:text/javascript;base64,${Buffer.from(backgroundCompiled).toString('base64')}`
);

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for background synchronization.');
}

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

async function bootstrap(store, userId = 'alice') {
  await store.beginBootstrap(userId, 'snapshot', '0');
  await store.completeBootstrap(userId, 'snapshot');
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
    await assert.rejects(store.acknowledge('alice', 'operation-3', '1', false), /first pending/);
    await assert.rejects(store.acknowledge('bob', 'operation-1', '1', true), /first pending/);
    await store.acknowledge('alice', 'operation-1', '1', true);
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
    await bootstrap(store);
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
      return {
        operationId: operation.operationId,
        userId: operation.userId,
        revision: operation.operationId === 'first' ? '1' : '2',
        value: operation.value,
      };
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
    await bootstrap(store);
    await store.setActivity('alice', 'topic', 'bookmark', true, 'first');
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const sync = new OfflineActivitySync(store, async () => {
      await wait;
      return { operationId: 'first', userId: 'bob', revision: '1', value: true };
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

test('preserves pending edits and newer server changes across delayed receipts', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await bootstrap(store);
    await store.setActivity('alice', 'topic', 'bookmark', true, 'first');
    await store.applyChanges('alice', [
      { topicId: 'topic', kind: 'bookmark', value: true, revision: '1' },
      { topicId: 'topic', kind: 'bookmark', value: false, revision: '2' },
    ]);
    assert.equal(await store.getActivity('alice', 'topic', 'bookmark'), true);
    await store.acknowledge('alice', 'first', '1', true);
    assert.equal(await store.getActivity('alice', 'topic', 'bookmark'), false);
    assert.equal(await store.cursor('alice'), '2');
  } finally {
    db.close();
  }
});

test('rejects gaps and rolls back both activity and cursor changes', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await bootstrap(store);
    await assert.rejects(
      store.applyChanges('alice', [
        { topicId: 'topic', kind: 'like', value: true, revision: '1' },
        { topicId: 'topic', kind: 'like', value: false, revision: '3' },
      ]),
      /incomplete/
    );
    assert.equal(await store.cursor('alice'), '0');
    assert.equal(await store.getActivity('alice', 'topic', 'like'), null);
  } finally {
    db.close();
  }
});

test('pulls bounded account-specific pages and resumes from the committed cursor', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await bootstrap(store);
    const sync = new OfflineActivitySync(store, async () => {
      throw new Error('Not used');
    });
    const requested = [];
    const fetch = async (userId, cursor) => {
      requested.push([userId, cursor]);
      return {
        userId,
        changes: [
          {
            topicId: 'topic',
            kind: 'like',
            value: cursor === '0',
            revision: cursor === '0' ? '1' : '2',
          },
        ],
        hasMore: cursor === '0',
      };
    };
    assert.equal(await sync.pull('alice', fetch, 1), 1);
    assert.equal(await store.cursor('alice'), '1');
    assert.equal(await sync.pull('alice', fetch), 1);
    assert.deepEqual(requested, [
      ['alice', '0'],
      ['alice', '1'],
    ]);
    assert.equal(await store.getActivity('alice', 'topic', 'like'), false);
    assert.equal(await store.getActivity('bob', 'topic', 'like'), null);
  } finally {
    db.close();
  }
});

test('rejects pages for another account without advancing the cursor', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await bootstrap(store);
    const sync = new OfflineActivitySync(store, async () => {
      throw new Error('Not used');
    });
    await assert.rejects(
      sync.pull('alice', async () => ({
        userId: 'bob',
        changes: [{ topicId: 'topic', kind: 'like', value: true, revision: '1' }],
        hasMore: false,
      })),
      /invalid offline activity page/
    );
    assert.equal(await store.cursor('alice'), '0');
    assert.equal(await store.getActivity('alice', 'topic', 'like'), null);
  } finally {
    db.close();
  }
});

test('does not send or apply activity before the account snapshot completes', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.setActivity('alice', 'topic', 'like', true, 'pending');
    await store.beginBootstrap('alice', 'snapshot', '0');
    let contacted = false;
    const sync = new OfflineActivitySync(store, async () => {
      contacted = true;
      throw new Error('Unexpected send');
    });
    await assert.rejects(sync.push('alice'), /initialized/);
    await assert.rejects(
      sync.pull('alice', async () => {
        contacted = true;
        throw new Error('Unexpected fetch');
      }),
      /initialized/
    );
    await assert.rejects(
      store.applyChanges('alice', [{ topicId: 'other', kind: 'like', value: true, revision: '1' }]),
      /initialized/
    );
    assert.equal(contacted, false);
    assert.equal(await store.isBootstrapped('alice'), false);
    assert.equal((await store.nextOperation('alice')).operationId, 'pending');
    await store.completeBootstrap('alice', 'snapshot');
    assert.equal(await store.isBootstrapped('alice'), true);
  } finally {
    db.close();
  }
});

test('bootstraps existing activity atomically while preserving pending edits', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    assert.equal(await store.isBootstrapped('alice'), false);
    await store.setActivity('alice', 'topic-1', 'bookmark', false, 'pending');
    await store.beginBootstrap('alice', 'snapshot-1', '12');
    await store.stageBootstrap('alice', 'snapshot-1', [
      { topicId: 'topic-1', kind: 'bookmark' },
      { topicId: 'topic-2', kind: 'like' },
    ]);
    assert.equal(await store.getActivity('alice', 'topic-2', 'like'), null);
    await store.completeBootstrap('alice', 'snapshot-1');
    assert.equal(await store.isBootstrapped('alice'), true);
    assert.equal(await store.cursor('alice'), '12');
    assert.equal(await store.getActivity('alice', 'topic-1', 'bookmark'), false);
    assert.equal(await store.getActivity('alice', 'topic-2', 'like'), true);
    assert.equal((await store.nextOperation('alice')).operationId, 'pending');
    await store.applyChanges('alice', [
      { topicId: 'topic-2', kind: 'like', value: false, revision: '13' },
    ]);
    assert.equal(await store.getActivity('alice', 'topic-2', 'like'), false);
    await assert.rejects(store.beginBootstrap('alice', 'snapshot-2', '13'), /already/);
  } finally {
    db.close();
  }
});

test('distinguishes an empty initial snapshot from an uninitialized account', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    assert.equal(await store.cursor('alice'), '0');
    assert.equal(await store.isBootstrapped('alice'), false);
    await store.beginBootstrap('alice', 'snapshot', '0');
    await store.completeBootstrap('alice', 'snapshot');
    assert.equal(await store.cursor('alice'), '0');
    assert.equal(await store.isBootstrapped('alice'), true);
    assert.equal(await store.isBootstrapped('bob'), false);
  } finally {
    db.close();
  }
});

test('restarting an interrupted bootstrap rejects pages from the old snapshot', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.beginBootstrap('alice', 'old', '2');
    await store.stageBootstrap('alice', 'old', [{ topicId: 'stale', kind: 'bookmark' }]);
    await store.beginBootstrap('alice', 'new', '3');
    await assert.rejects(store.stageBootstrap('alice', 'old', []), /replaced/);
    await assert.rejects(store.completeBootstrap('alice', 'old'), /replaced/);
    await store.stageBootstrap('alice', 'new', [{ topicId: 'current', kind: 'like' }]);
    await store.completeBootstrap('alice', 'new');
    assert.equal(await store.getActivity('alice', 'stale', 'bookmark'), null);
    assert.equal(await store.getActivity('alice', 'current', 'like'), true);
    assert.equal(await store.cursor('alice'), '3');
    assert.equal(await store.getActivity('bob', 'current', 'like'), null);
  } finally {
    db.close();
  }
});

test('bootstrap does not overwrite a newer acknowledged server state', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.beginBootstrap('alice', 'snapshot', '9');
    await store.stageBootstrap('alice', 'snapshot', [{ topicId: 'topic', kind: 'like' }]);
    await store.setActivity('alice', 'topic', 'like', false, 'pending');
    await store.acknowledge('alice', 'pending', '10', false);
    await store.completeBootstrap('alice', 'snapshot');
    assert.equal(await store.getActivity('alice', 'topic', 'like'), false);
    assert.equal(await store.cursor('alice'), '9');
  } finally {
    db.close();
  }
});

test('background sync waits for connectivity and retries failed operations', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  let online = false;
  const attempts = [];
  const errors = [];
  const recovered = [];
  let background;
  try {
    await store.initialize();
    await bootstrap(store);
    await store.setActivity('alice', 'topic', 'like', true, 'operation');
    const sync = new OfflineActivitySync(store, async (operation) => {
      attempts.push(operation.operationId);
      if (attempts.length === 1) throw new Error('Connection interrupted');
      return {
        operationId: operation.operationId,
        userId: operation.userId,
        revision: '1',
        value: true,
      };
    });
    background = new BackgroundActivitySync(
      sync,
      async (userId) => ({ userId, changes: [], hasMore: false }),
      () => online,
      (userId, error) => errors.push([userId, error.message]),
      (userId) => recovered.push(userId)
    );
    background.setUser('alice');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(attempts, []);
    online = true;
    background.requestSync();
    await waitFor(() => errors.length === 1);
    assert.equal((await store.nextOperation('alice')).operationId, 'operation');
    background.requestSync();
    await waitFor(() => recovered.length === 1);
    assert.deepEqual(attempts, ['operation', 'operation']);
    assert.deepEqual(errors, [['alice', 'Connection interrupted']]);
    assert.deepEqual(recovered, ['alice']);
    assert.equal(await store.nextOperation('alice'), null);
  } finally {
    background?.dispose();
    db.close();
  }
});

test('backs off after an error even when a full batch requested another cycle', async () => {
  let pushes = 0;
  const errors = [];
  const engine = {
    async push() {
      pushes++;
      return 1;
    },
    async pull() {
      throw new Error('Server unavailable');
    },
  };
  const background = new BackgroundActivitySync(
    engine,
    async () => {
      throw new Error('Not used');
    },
    () => true,
    (_userId, error) => errors.push(error.message),
    () => {}
  );
  try {
    background.setUser('alice');
    await waitFor(() => errors.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(pushes, 100);
    assert.deepEqual(errors, ['Server unavailable']);
  } finally {
    background.dispose();
  }
});

test('background sync stops the old account before starting a different one', async () => {
  const calls = [];
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  const engine = {
    async push(userId) {
      calls.push(`push:${userId}`);
      if (userId === 'alice') await first;
      return 0;
    },
    async pull(userId) {
      calls.push(`pull:${userId}`);
      return 0;
    },
  };
  const background = new BackgroundActivitySync(
    engine,
    async () => {
      throw new Error('Not used');
    },
    () => true,
    () => {
      throw new Error('Unexpected sync error');
    },
    () => {}
  );
  try {
    background.setUser('alice');
    await waitFor(() => calls.includes('push:alice'));
    background.setUser('bob');
    release();
    await waitFor(() => calls.includes('pull:bob'));
    assert.deepEqual(calls, ['push:alice', 'push:bob', 'pull:bob']);
  } finally {
    background.dispose();
  }
});
