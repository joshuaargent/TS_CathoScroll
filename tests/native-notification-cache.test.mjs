import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const { NotificationCache } = await import(moduleUrl(await compile('../native/notification-cache.ts')));
const { NativeNotificationService } = await import(moduleUrl(await compile('../native/notification-service.ts')));

function fixture() {
  const db = new DatabaseSync(':memory:');
  let tail = Promise.resolve();
  const database = {
    transaction(callback) {
      const current = tail.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await callback({
            async execute(sql, values = []) { db.prepare(sql).run(...values); },
            async query(sql, values = []) { return db.prepare(sql).all(...values); },
          });
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      tail = current.then(() => undefined, () => undefined);
      return current;
    },
  };
  return { db, cache: new NotificationCache(database) };
}

function notification(id, readAt = null) {
  return {
    id, type: 'reply', title: `Reply ${id}`, body: 'A reply was posted.',
    topic_id: 'topic-one', topic_slug: 'topic-one', comment_id: id,
    read_at: readAt, created_at: new Date(1_700_000_000_000 + id * 1000).toISOString(),
  };
}

function online(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
}

test('offline notification snapshots and queued read operations are isolated by account', async (t) => {
  const { db, cache } = fixture();
  t.after(() => db.close());
  await cache.initialize();
  await cache.saveIfClean('alice', { notifications: [notification(1)], unreadCount: 1 }, null);
  await cache.saveIfClean('bob', { notifications: [notification(2)], unreadCount: 1 }, null);
  await cache.mark('alice', 1);
  assert.notEqual((await cache.load('alice')).notifications[0].read_at, null);
  assert.equal((await cache.load('alice')).unreadCount, 0);
  assert.equal((await cache.load('bob')).notifications[0].read_at, null);
  assert.equal((await cache.next('alice')).all, false);
  assert.equal(await cache.next('bob'), null);
});

test('mark-all records a stable cutoff and prevents a pending refresh overwriting local state', async (t) => {
  const { db, cache } = fixture();
  t.after(() => db.close());
  await cache.initialize();
  await cache.saveIfClean('alice', {
    notifications: [notification(10), notification(9), notification(8)], unreadCount: 3,
  }, null);
  await cache.mark('alice', 'all');
  assert.deepEqual(await cache.next('alice'), { sequence: 1, cutoff: 10, all: true });
  const current = await cache.load('alice');
  assert.equal(current.unreadCount, 0);
  assert.ok(current.notifications.every((row) => row.read_at !== null));
  const refreshed = await cache.saveIfClean('alice', {
    notifications: [notification(11)], unreadCount: 1,
  }, 0);
  assert.equal(refreshed.unreadCount, 0);
  assert.equal((await cache.next('alice')).cutoff, 10);
});

test('notification sync retries a lost response without dropping the outbox operation', async (t) => {
  online(t);
  const { db, cache } = fixture();
  t.after(() => db.close());
  await cache.initialize();
  await cache.saveIfClean('alice', { notifications: [notification(1)], unreadCount: 1 }, null);
  await cache.mark('alice', 1);
  let calls = 0;
  const remote = {
    async syncRead() { calls++; if (calls === 1) throw new Error('Connection lost after request.'); },
    async load() { return { notifications: [], unreadCount: 0 }; },
    async markAsRead() {},
  };
  const service = new NativeNotificationService('alice', cache, remote);
  await assert.rejects(service.sync(), /Connection lost/);
  assert.ok(await cache.next('alice'));
  await service.sync();
  assert.equal(calls, 2);
  assert.equal(await cache.next('alice'), null);
});

test('a mark queued as an empty drain finishes is synchronized without waiting for polling', async (t) => {
  online(t);
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  let pending = false;
  let acknowledged = false;
  let remoteCalls = 0;
  const cache = {
    async next() {
      if (first) { first = false; entered(); await gate; return null; }
      return pending && !acknowledged ? { sequence: 1, cutoff: 20, all: true } : null;
    },
    async acknowledge(_userId, sequence) {
      assert.equal(sequence, 1);
      acknowledged = true;
      pending = false;
    },
  };
  const remote = {
    async syncRead(cutoff, all) {
      assert.equal(cutoff, 20);
      assert.equal(all, true);
      remoteCalls++;
    },
    async load() { return { notifications: [], unreadCount: 0 }; },
    async markAsRead() {},
  };
  const service = new NativeNotificationService('alice', cache, remote);
  const firstSync = service.sync();
  await enteredPromise;
  pending = true;
  const joinedSync = service.sync();
  release();
  await Promise.all([firstSync, joinedSync]);
  assert.equal(remoteCalls, 1);
  assert.equal(acknowledged, true);
});


test('rejects malformed notification snapshots before storing them', async (t) => {
  const { db, cache } = fixture();
  t.after(() => db.close());
  await cache.initialize();
  const valid = {
    notifications: [{
      id: 1, type: 'reply', title: 'Reply', body: 'A reply was posted.',
      topic_id: 'topic-one', topic_slug: 'topic-one', comment_id: 1,
      read_at: null, created_at: '2026-11-15T10:00:00.000Z',
    }],
    unreadCount: 1,
  };
  await assert.rejects(cache.saveIfClean('alice', {
    notifications: [valid.notifications[0], valid.notifications[0]],
    unreadCount: 2,
  }, null), /Duplicate saved notification/);
  await assert.rejects(cache.saveIfClean('alice', {
    notifications: [{ ...valid.notifications[0], created_at: 'not-a-date' }],
    unreadCount: 1,
  }, null), /Invalid saved notification/);
  await assert.rejects(cache.saveIfClean('alice', {
    notifications: [{ ...valid.notifications[0], title: 'x'.repeat(16_385) }],
    unreadCount: 1,
  }, null), /Invalid saved notification/);
  assert.equal(await cache.load('alice'), null);
});
