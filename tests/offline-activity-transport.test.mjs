import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/supabase-activity-transport.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SupabaseActivityTransport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture(response) {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
  };
  return { calls, transport: new SupabaseActivityTransport(client) };
}

test('maps activity operations to account-bound RPCs and validates receipts', async () => {
  const operation = {
    userId: 'alice',
    operationId: 'operation',
    topicId: 'topic',
    kind: 'like',
    value: true,
  };
  const { calls, transport } = fixture({
    data: { userId: 'alice', operationId: 'operation', revision: '42', value: true },
    error: null,
  });
  assert.deepEqual(await transport.send(operation), {
    userId: 'alice',
    operationId: 'operation',
    revision: '42',
    value: true,
  });
  assert.deepEqual(calls, [
    {
      name: 'offline_apply_activity',
      args: {
        p_user: 'alice',
        p_operation: 'operation',
        p_topic: 'topic',
        p_kind: 'like',
        p_value: true,
      },
    },
  ]);
  const mismatch = fixture({
    data: { userId: 'bob', operationId: 'operation', revision: '42', value: true },
    error: null,
  });
  await assert.rejects(mismatch.transport.send(operation), /account/);
});

test('rejects invalid snapshots, revisions, and server failures', async () => {
  await assert.rejects(
    fixture({ data: { userId: 'alice', revision: '01' }, error: null }).transport.head('alice'),
    /revision/
  );
  await assert.rejects(
    fixture({
      data: {
        userId: 'alice',
        items: [{ topicId: 'topic', kind: 'unexpected' }],
        nextCursor: null,
      },
      error: null,
    }).transport.snapshot('alice', null),
    /kind/
  );
  await assert.rejects(
    fixture({
      data: {
        userId: 'alice',
        changes: [{ topicId: 'topic', kind: 'like', value: 'true', revision: '1' }],
        hasMore: false,
      },
      error: null,
    }).transport.changes('alice', '0'),
    /value/
  );
  await assert.rejects(
    fixture({ data: null, error: { message: 'Unavailable' } }).transport.head('alice'),
    /Unavailable/
  );
});
