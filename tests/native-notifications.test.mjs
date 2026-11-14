import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../native/notification-operations.ts', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { notificationTransport } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
});

function client(userId = 'user-1') {
  const queries = [];
  return {
    queries,
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      const state = { table, filters: [] };
      queries.push(state);
      const builder = {
        select(columns, options) {
          state.columns = columns;
          state.countOnly = options?.head ?? false;
          return this;
        },
        update(value) {
          state.update = value;
          return this;
        },
        eq(field, value) {
          state.filters.push([field, value]);
          return this;
        },
        is(field, value) {
          state.filters.push([field, value]);
          return this;
        },
        lte(field, value) {
          state.filters.push([field, '<=', value]);
          return this;
        },
        order(field, options) {
          state.order = [field, options];
          return this;
        },
        limit(value) {
          state.limit = value;
          return this;
        },
        in(field, values) {
          state.filters.push([field, values]);
          return this;
        },
        then(resolve, reject) {
          let result;
          if (state.update) result = { data: [{ id: 1 }], error: null };
          else if (table === 'topics')
            result = { data: [{ id: 'topic-1', slug: 'grace' }], error: null };
          else if (state.countOnly) result = { count: 2, error: null };
          else result = { data: [{ id: 1, topic_id: 'topic-1' }], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('loads and updates only the verified account notifications', async () => {
  const api = client();
  const transport = notificationTransport(api, 'user-1');
  const result = await transport.load();
  assert.equal(result.unreadCount, 2);
  assert.equal(result.notifications[0].topic_slug, 'grace');
  assert.equal(api.queries[1].limit, 50);
  assert.deepEqual(api.queries[1].filters, [['user_id', 'user-1']]);
  await transport.markAsRead(1);
  const update = api.queries.at(-1);
  assert.deepEqual(update.filters, [
    ['user_id', 'user-1'],
    ['read_at', null],
    ['id', 1],
  ]);
  assert.ok(update.update.read_at);
  await transport.markAsRead('all');
  assert.deepEqual(api.queries.at(-1).filters, [
    ['user_id', 'user-1'],
    ['read_at', null],
  ]);
  await transport.syncRead(10, true);
  assert.deepEqual(api.queries.at(-1).filters, [
    ['user_id', 'user-1'],
    ['read_at', null],
    ['id', '<=', 10],
  ]);
});

test('does not access notifications for another account or while offline', async () => {
  const api = client('user-2');
  await assert.rejects(notificationTransport(api, 'user-1').markAsRead('all'), /account changed/);
  assert.equal(api.queries.length, 0);
  navigator.onLine = false;
  try {
    await assert.rejects(notificationTransport(api, 'user-1').load(), /Connect/);
    assert.equal(api.queries.length, 0);
  } finally {
    navigator.onLine = true;
  }
});
