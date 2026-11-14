import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { NotificationCache } = await load('../native/notification-cache.ts');
const { NativeNotificationService } = await load('../native/notification-service.ts');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

function database() {
  const sqlite = new DatabaseSync(':memory:');
  let tail = Promise.resolve();
  return {
    close: () => sqlite.close(),
    transaction(callback) {
      const current = tail.then(async () => {
        sqlite.exec('BEGIN');
        try {
          const result = await callback({
            async execute(sql, values = []) {
              sqlite.prepare(sql).run(...values);
            },
            async query(sql, values = []) {
              return sqlite.prepare(sql).all(...values);
            },
          });
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
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

function notice(id) {
  return {
    id,
    type: 'reply',
    title: 'Reply',
    body: 'Hello',
    topic_id: 'topic',
    topic_slug: 'topic',
    comment_id: null,
    read_at: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

test('persists offline read changes, isolates accounts and retries bounded mark-all', async () => {
  const db = database();
  try {
    const cache = new NotificationCache(db);
    await cache.initialize();
    await cache.saveIfClean('a', { notifications: [notice(10), notice(9)], unreadCount: 2 }, null);
    const calls = [];
    let fail = true;
    const remote = {
      async syncRead(cutoff, all) {
        calls.push([cutoff, all]);
        if (fail) throw new Error('lost response');
      },
      async load() {
        return { notifications: [notice(11)], unreadCount: 1 };
      },
    };
    const service = new NativeNotificationService('a', cache, remote);
    navigator.onLine = false;
    await service.markAsRead('all');
    assert.equal((await service.load()).unreadCount, 0);
    assert.equal(await cache.load('b'), null);
    await assert.rejects(service.ensureNoPending(), /need to sync/);
    navigator.onLine = true;
    await assert.rejects(service.sync(), /lost response/);
    assert.ok(await cache.next('a'));
    fail = false;
    await service.sync();
    assert.equal(await cache.next('a'), null);
    assert.deepEqual(calls, [
      [10, true],
      [10, true],
    ]);
    assert.equal((await service.load()).notifications[0].id, 11);
    await service.ensureNoPending();
  } finally {
    navigator.onLine = true;
    db.close();
  }
});

test('a late server refresh cannot overwrite an offline read', async () => {
  const db = database();
  try {
    const cache = new NotificationCache(db);
    await cache.initialize();
    await cache.saveIfClean('a', { notifications: [notice(10)], unreadCount: 1 }, null);
    let release;
    let started;
    const ready = new Promise((resolve) => (started = resolve));
    const remote = {
      async syncRead() {},
      async load() {
        started();
        await new Promise((resolve) => (release = resolve));
        return { notifications: [notice(10)], unreadCount: 1 };
      },
    };
    const service = new NativeNotificationService('a', cache, remote);
    const loading = service.load();
    await ready;
    await service.markAsRead(10);
    await service.sync();
    release();
    const result = await loading;
    assert.equal(result.unreadCount, 0);
    assert.ok(result.notifications[0].read_at);
  } finally {
    db.close();
  }
});
