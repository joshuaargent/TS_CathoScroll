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
const bootstrapSource = await readFile(
  new URL('../src/lib/offline/activity-bootstrap.ts', import.meta.url),
  'utf8'
);
const bootstrapCompiled = ts.transpileModule(bootstrapSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { bootstrapActivity } = await import(
  `data:text/javascript;base64,${Buffer.from(bootstrapCompiled).toString('base64')}`
);
const transportSource = await readFile(
  new URL('../src/lib/offline/supabase-activity-transport.ts', import.meta.url),
  'utf8'
);
const transportCompiled = ts.transpileModule(transportSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SupabaseActivityTransport } = await import(
  `data:text/javascript;base64,${Buffer.from(transportCompiled).toString('base64')}`
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

test('preserves completion times through restart, pending edits, receipts and deltas', async (t) => {
  const file = await databaseFile(t);
  let db = new DatabaseSync(file);
  let store = new OfflineActivityStore(adapter(db));
  const recorded = '2024-01-03T12:30:45.123Z';
  const earlier = '2024-01-02T09:00:00+00:00';
  await store.initialize();
  await bootstrap(store);
  await store.setActivity('alice', 'topic', 'progress', true, 'complete', recorded);
  await store.setActivity('alice', 'topic', 'progress', false, 'undo');
  db.close();

  db = new DatabaseSync(file);
  store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    assert.equal((await store.nextOperation('alice')).completedAt, recorded);
    await store.acknowledge('alice', 'complete', '1', true, earlier);
    assert.equal((await store.topicActivity('alice', 'topic')).completedAt, null);
    assert.equal((await store.nextOperation('alice')).operationId, 'undo');
    await store.acknowledge('alice', 'undo', '2', false);
    await store.applyChanges('alice', [
      { topicId: 'topic', kind: 'progress', value: true, revision: '1', completedAt: earlier },
      { topicId: 'topic', kind: 'progress', value: false, revision: '2', completedAt: null },
      { topicId: 'topic', kind: 'progress', value: true, revision: '3', completedAt: recorded },
    ]);
    assert.equal((await store.topicActivity('alice', 'topic')).completedAt, recorded);
    await assert.rejects(
      store.setActivity('alice', 'topic', 'progress', true, 'bad', null),
      /completion time/
    );
    await assert.rejects(
      store.applyChanges('alice', [
        { topicId: 'topic', kind: 'progress', value: true, revision: '4', completedAt: null },
      ]),
      /completion time/
    );
    assert.equal(await store.cursor('alice'), '3');
  } finally {
    db.close();
  }
});

test('compares equivalent completion times without losing sub-millisecond precision', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new OfflineActivityStore(adapter(db));
  const timestamp = '2024-01-03T12:30:45.123456Z';
  try {
    await store.initialize();
    await bootstrap(store);
    await store.setActivity('alice', 'topic', 'progress', true, 'first', timestamp);
    await store.acknowledge('alice', 'first', '1', true, '2024-01-03T12:30:45.123456+00:00');
    await store.applyChanges('alice', [
      { topicId: 'topic', kind: 'progress', value: true, revision: '1', completedAt: timestamp },
    ]);
    await store.setActivity('alice', 'other', 'progress', true, 'second', timestamp);
    await store.acknowledge('alice', 'second', '2', true, timestamp);
    await assert.rejects(
      store.applyChanges('alice', [
        {
          topicId: 'other',
          kind: 'progress',
          value: true,
          revision: '2',
          completedAt: '2024-01-03T12:30:45.123457Z',
        },
      ]),
      /Conflicting/
    );
    assert.equal(await store.cursor('alice'), '1');
  } finally {
    db.close();
  }
});

test('reads account state and pages saved topics without exposing another account', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await assert.rejects(store.topicActivity('alice', 'topic'), /initialized/);
    await assert.rejects(store.listActivity('alice', 'bookmark'), /initialized/);
    await bootstrap(store);
    await bootstrap(store, 'bob');
    for (let i = 0; i < 55; i++) {
      const topic = `topic-${String(i).padStart(3, '0')}`;
      await store.setActivity('alice', topic, 'bookmark', true, `operation-${i}`);
    }
    await store.setActivity('alice', 'topic-000', 'like', true, 'like');
    await store.setActivity('alice', 'topic-001', 'bookmark', false, 'remove');
    await store.setActivity('bob', 'other', 'bookmark', true, 'bob-bookmark');
    assert.deepEqual(await store.topicActivity('alice', 'topic-000'), {
      liked: true,
      bookmarked: true,
      completed: false,
      completedAt: null,
    });
    const first = await store.listActivity('alice', 'bookmark');
    const second = await store.listActivity('alice', 'bookmark', first.nextCursor);
    assert.equal(first.topicIds.length, 50);
    assert.equal(second.topicIds.length, 4);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.topicIds, ...second.topicIds]).size, 54);
    assert.equal(first.topicIds.includes('topic-001'), false);
    assert.deepEqual((await store.listActivity('bob', 'bookmark')).topicIds, ['other']);
    assert.equal(await store.pendingCount('alice'), 57);
    assert.equal(await store.pendingCount('bob'), 1);
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

test('rejects numeric revisions without losing queued operations or advancing the cursor', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await bootstrap(store);
    await store.setActivity('alice', 'topic', 'like', true, 'first');

    await assert.rejects(store.acknowledge('alice', 'first', 1, true), /revision/);
    await assert.rejects(
      store.applyChanges('alice', [{ topicId: 'topic', kind: 'like', value: true, revision: 1 }]),
      /revision/
    );
    assert.equal((await store.nextOperation('alice')).operationId, 'first');
    assert.equal(await store.cursor('alice'), '0');
    assert.equal(await store.getActivity('alice', 'topic', 'like'), true);
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

test('reconciles changes during paginated bootstrap before exposing account state', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    await store.setActivity('alice', 'pending', 'bookmark', false, 'pending-operation');
    let heads = 0;
    const transport = {
      async head(userId) {
        return { userId, revision: ++heads === 1 ? '4' : '7' };
      },
      async snapshot(userId, cursor) {
        assert.equal(await store.isBootstrapped(userId), false);
        return cursor === null
          ? {
              userId,
              items: [
                { topicId: 'deleted', kind: 'like' },
                { topicId: 'pending', kind: 'bookmark' },
              ],
              nextCursor: 'page-2',
            }
          : {
              userId,
              items: [{ topicId: 'future', kind: 'progress', completedAt: '2024-01-01T00:00:00Z' }],
              nextCursor: null,
            };
      },
      async changes(userId, cursor) {
        assert.equal(await store.isBootstrapped(userId), false);
        if (cursor === '4') {
          return {
            userId,
            changes: [
              { topicId: 'deleted', kind: 'like', value: false, revision: '5' },
              { topicId: 'future', kind: 'progress', value: false, revision: '6' },
            ],
            hasMore: true,
          };
        }
        assert.equal(cursor, '6');
        return {
          userId,
          changes: [
            {
              topicId: 'future',
              kind: 'progress',
              value: true,
              revision: '7',
              completedAt: '2024-01-02T00:00:00Z',
            },
          ],
          hasMore: false,
        };
      },
    };
    await bootstrapActivity(store, transport, 'alice', 'initial');
    assert.equal(await store.isBootstrapped('alice'), true);
    assert.equal(await store.cursor('alice'), '7');
    assert.equal(await store.getActivity('alice', 'deleted', 'like'), false);
    assert.equal(await store.getActivity('alice', 'future', 'progress'), true);
    assert.equal(
      (await store.topicActivity('alice', 'future')).completedAt,
      '2024-01-02T00:00:00Z'
    );
    assert.equal(await store.getActivity('alice', 'pending', 'bookmark'), false);
    assert.equal((await store.nextOperation('alice')).operationId, 'pending-operation');
  } finally {
    db.close();
  }
});

test('leaves bootstrap unfinished on gaps, account mismatch, or cancellation', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    const transport = {
      async head(userId) {
        return { userId, revision: '0' };
      },
      async snapshot() {
        return { userId: 'bob', items: [], nextCursor: null };
      },
      async changes() {
        throw new Error('Not used');
      },
    };
    await assert.rejects(bootstrapActivity(store, transport, 'alice', 'one'), /snapshot page/);
    assert.equal(await store.isBootstrapped('alice'), false);
    let calls = 0;
    transport.head = async (userId) => ({ userId, revision: ++calls === 1 ? '0' : '2' });
    transport.snapshot = async (userId) => ({
      userId,
      items: [{ topicId: 'topic', kind: 'like' }],
      nextCursor: null,
    });
    transport.changes = async (userId) => ({
      userId,
      changes: [{ topicId: 'topic', kind: 'like', value: false, revision: '2' }],
      hasMore: false,
    });
    await assert.rejects(bootstrapActivity(store, transport, 'alice', 'two'), /incomplete/);
    assert.equal(await store.isBootstrapped('alice'), false);
    assert.equal(await store.getActivity('alice', 'topic', 'like'), null);
    const controller = new AbortController();
    transport.head = async (userId) => {
      controller.abort();
      return { userId, revision: '0' };
    };
    await assert.rejects(
      bootstrapActivity(store, transport, 'alice', 'three', controller.signal),
      /abort/i
    );
    assert.equal(await store.isBootstrapped('alice'), false);
  } finally {
    db.close();
  }
});

test('upgrades an interrupted older bootstrap without discarding staged data', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE offline_activity_bootstrap_items (
        user_id TEXT NOT NULL, topic_id TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (user_id, topic_id, kind)
      );
      INSERT INTO offline_activity_bootstrap_items VALUES ('alice', 'topic', 'like');
      CREATE TABLE offline_activity_bootstrap (
        user_id TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL, revision TEXT NOT NULL
      );
      INSERT INTO offline_activity_bootstrap VALUES ('alice', 'snapshot', '0');
    `);
    const store = new OfflineActivityStore(adapter(db));
    await store.initialize();
    await store.applyBootstrapChanges('alice', 'snapshot', [
      { topicId: 'topic', kind: 'like', value: false, revision: '1' },
    ]);
    await store.completeBootstrap('alice', 'snapshot');
    assert.equal(await store.getActivity('alice', 'topic', 'like'), false);
    assert.equal(await store.cursor('alice'), '1');
  } finally {
    db.close();
  }
});

test('preserves older queued progress and refuses to publish a snapshot without its time', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE offline_activity_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL, topic_id TEXT NOT NULL, kind TEXT NOT NULL, value INTEGER NOT NULL
      );
      INSERT INTO offline_activity_outbox (operation_id, user_id, topic_id, kind, value)
      VALUES ('old-operation', 'alice', 'topic', 'progress', 1);
      CREATE TABLE offline_activity_bootstrap_items (
        user_id TEXT NOT NULL, topic_id TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (user_id, topic_id, kind)
      );
      INSERT INTO offline_activity_bootstrap_items VALUES ('alice', 'topic', 'progress');
      CREATE TABLE offline_activity_bootstrap (
        user_id TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL, revision TEXT NOT NULL
      );
      INSERT INTO offline_activity_bootstrap VALUES ('alice', 'snapshot', '0');
    `);
    const store = new OfflineActivityStore(adapter(db));
    await store.initialize();
    assert.equal(await store.pendingCount('alice'), 1);
    await assert.rejects(store.nextOperation('alice'), /completion time/);
    await assert.rejects(store.completeBootstrap('alice', 'snapshot'), /completion time/);
    assert.equal(await store.isBootstrapped('alice'), false);
    assert.equal(await store.pendingCount('alice'), 1);
  } finally {
    db.close();
  }
});

test('rejects repeated snapshot cursors without making a partial account visible', async (t) => {
  const file = await databaseFile(t);
  const db = new DatabaseSync(file);
  const store = new OfflineActivityStore(adapter(db));
  try {
    await store.initialize();
    const transport = {
      async head(userId) {
        return { userId, revision: '0' };
      },
      async snapshot(userId) {
        return { userId, items: [{ topicId: 'topic', kind: 'like' }], nextCursor: 'same' };
      },
      async changes() {
        throw new Error('Not used');
      },
    };
    await assert.rejects(bootstrapActivity(store, transport, 'alice', 'snapshot'), /snapshot page/);
    assert.equal(await store.isBootstrapped('alice'), false);
    assert.equal(await store.getActivity('alice', 'topic', 'like'), null);
  } finally {
    db.close();
  }
});

test('bootstraps and synchronizes two devices with a lost write response', async () => {
  const firstDb = new DatabaseSync(':memory:');
  const secondDb = new DatabaseSync(':memory:');
  const first = new OfflineActivityStore(adapter(firstDb));
  const second = new OfflineActivityStore(adapter(secondDb));
  const events = [];
  const receipts = new Map();
  const state = new Map([['like:topic', true]]);
  let modifyDuringSnapshot = true;
  let loseResponse = true;
  function recordChange(kind, topicId, value) {
    state.set(`${kind}:${topicId}`, value);
    const change = { kind, topicId, value, revision: String(events.length + 1) };
    events.push(change);
    return change;
  }
  const client = {
    async rpc(name, args) {
      const userId = args.p_user;
      if (userId !== 'alice') return { error: { message: 'Account does not match' }, data: null };
      if (name === 'offline_activity_head') {
        return { data: { userId, revision: String(events.length) }, error: null };
      }
      if (name === 'offline_activity_snapshot') {
        const items = [...state.entries()]
          .filter(([, value]) => value)
          .map(([key]) => {
            const [kind, topicId] = key.split(':');
            return { kind, topicId };
          });
        if (modifyDuringSnapshot) {
          modifyDuringSnapshot = false;
          recordChange('like', 'topic', false);
        }
        return { data: { userId, items, nextCursor: null }, error: null };
      }
      if (name === 'offline_activity_changes') {
        return {
          data: {
            userId,
            changes: events.filter((change) => BigInt(change.revision) > BigInt(args.p_after)),
            hasMore: false,
          },
          error: null,
        };
      }
      if (name === 'offline_apply_activity') {
        let receipt = receipts.get(args.p_operation);
        if (!receipt) {
          const change = recordChange(args.p_kind, args.p_topic, args.p_value);
          receipt = {
            userId,
            operationId: args.p_operation,
            revision: change.revision,
            value: args.p_value,
          };
          receipts.set(args.p_operation, receipt);
        }
        if (loseResponse) {
          loseResponse = false;
          throw new Error('Connection interrupted after commit');
        }
        return { data: receipt, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  try {
    await first.initialize();
    await second.initialize();
    const transport = new SupabaseActivityTransport(client);
    await bootstrapActivity(first, transport, 'alice', 'first-snapshot');
    await bootstrapActivity(second, transport, 'alice', 'second-snapshot');
    assert.equal(await first.getActivity('alice', 'topic', 'like'), false);
    await first.setActivity('alice', 'topic', 'bookmark', true, 'operation');
    const sync = new OfflineActivitySync(first, (operation) => transport.send(operation));
    await assert.rejects(sync.push('alice'), /interrupted/);
    assert.equal((await first.nextOperation('alice')).operationId, 'operation');
    assert.equal(await sync.push('alice'), 1);
    assert.equal(events.length, 2);
    const secondSync = new OfflineActivitySync(second, (operation) => transport.send(operation));
    await secondSync.pull('alice', (userId, cursor) => transport.changes(userId, cursor));
    assert.equal(await second.getActivity('alice', 'topic', 'bookmark'), true);
  } finally {
    firstDb.close();
    secondDb.close();
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
