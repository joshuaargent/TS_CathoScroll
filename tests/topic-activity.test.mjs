import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/topic-activity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { loadTopicActivity } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function mockClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      rpc(name, args) {
        calls.push({ type: 'rpc', name, args });
        return Promise.resolve(responses[`rpc:${name}`]);
      },
      from(table) {
        const call = { type: 'table', table, filters: [] };
        calls.push(call);
        const builder = {
          select(columns, options) {
            call.columns = columns;
            call.options = options;
            return builder;
          },
          eq(column, value) {
            call.filters.push([column, value]);
            return builder;
          },
          maybeSingle() {
            return Promise.resolve(responses[`${table}:user`]);
          },
          then(resolve, reject) {
            return Promise.resolve(responses[`${table}:count`]).then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };
}

test('loads exact counts and only the current user and topic state', async () => {
  const { client, calls } = mockClient({
    'rpc:get_topic_like_state': {
      data: [{ likes: 5001, liked: true }],
      error: null,
    },
    'comments:count': { count: 2001, error: null },
    'bookmarks:user': { data: null, error: null },
    'progress:user': { data: { topic_id: 'topic-1' }, error: null },
  });

  assert.deepEqual(await loadTopicActivity(client, 'topic-1', 'user-1'), {
    topicId: 'topic-1',
    userId: 'user-1',
    likes: 5001,
    comments: 2001,
    liked: true,
    bookmarked: false,
    completed: true,
  });
  assert.equal(calls.length, 4);
  const likeRpc = calls.find((call) => call.type === 'rpc');
  assert.equal(likeRpc.name, 'get_topic_like_state');
  assert.deepEqual(likeRpc.args, { p_topic_id: 'topic-1' });
  const tableCalls = calls.filter((call) => call.type === 'table');
  for (const call of tableCalls)
    assert(call.filters.some(([key, value]) => key === 'topic_id' && value === 'topic-1'));
  for (const call of tableCalls.filter((entry) => !entry.options?.head)) {
    assert(call.filters.some(([key, value]) => key === 'user_id' && value === 'user-1'));
  }
  assert(
    tableCalls
      .find((call) => call.table === 'comments')
      .filters.some(([key, value]) => key === 'is_deleted' && value === false)
  );
  assert(
    tableCalls.filter((call) => call.options?.head).every((call) => call.options.count === 'exact')
  );
});

test('does not request private activity for a signed-out user', async () => {
  const { client, calls } = mockClient({
    'rpc:get_topic_like_state': {
      data: [{ likes: 0, liked: false }],
      error: null,
    },
    'comments:count': { count: 0, error: null },
  });
  const activity = await loadTopicActivity(client, 'topic-1', null);
  assert.equal(calls.filter((call) => call.type === 'table').length, 1);
  assert.equal(calls.filter((call) => call.type === 'rpc').length, 1);
  assert.equal(activity.liked, false);
  assert.equal(activity.bookmarked, false);
  assert.equal(activity.completed, false);
});

test('reports query failures and missing counts instead of presenting zero', async () => {
  const { client } = mockClient({
    'rpc:get_topic_like_state': {
      data: null,
      error: { message: 'database unavailable' },
    },
    'comments:count': { count: 0, error: null },
  });
  await assert.rejects(loadTopicActivity(client, 'topic-1', null), /database unavailable/);

  const missing = mockClient({
    'rpc:get_topic_like_state': { data: [], error: null },
    'comments:count': { count: 0, error: null },
  });
  await assert.rejects(loadTopicActivity(missing.client, 'topic-1', null), /counts/);
});
