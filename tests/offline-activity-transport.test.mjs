import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/supabase-activity-transport.ts', import.meta.url),
  'utf8'
);
const timeoutSource = await readFile(
  new URL('../src/lib/offline/request-timeout.ts', import.meta.url),
  'utf8'
);
const timeoutCompiled = ts.transpileModule(timeoutSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(
    "'./request-timeout'",
    `'data:text/javascript;base64,${Buffer.from(timeoutCompiled).toString('base64')}'`
  );
const { SupabaseActivityTransport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture(response) {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return { abortSignal: () => Promise.resolve(response) };
    },
  };
  return { calls, transport: new SupabaseActivityTransport(client) };
}

test('maps activity operations to account-bound RPCs and validates receipts', async () => {
  const operation = {
    userId: 'alice',
    operationId: 'operation',
    deviceId: 'device',
    sequence: '2',
    acknowledgedSequence: '1',
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
    completedAt: null,
  });
  assert.deepEqual(calls, [
    {
      name: 'offline_apply_activity_v2',
      args: {
        p_user: 'alice',
        p_operation: 'operation',
        p_device: 'device',
        p_sequence: '2',
        p_acknowledged: '1',
        p_topic: 'topic',
        p_kind: 'like',
        p_value: true,
        p_completed_at: null,
      },
    },
  ]);
  const mismatch = fixture({
    data: { userId: 'bob', operationId: 'operation', revision: '42', value: true },
    error: null,
  });
  await assert.rejects(mismatch.transport.send(operation), /account/);
  const invalidSequence = fixture({ data: null, error: null });
  await assert.rejects(
    invalidSequence.transport.send({ ...operation, acknowledgedSequence: '2' }),
    /device sequence/
  );
  assert.equal(invalidSequence.calls.length, 0);
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

test('transports completion timestamps and rejects missing timestamps', async () => {
  const timestamp = '2024-01-03T12:30:45.123Z';
  const operation = {
    userId: 'alice',
    operationId: 'complete',
    deviceId: 'device',
    sequence: '1',
    acknowledgedSequence: '0',
    topicId: 'topic',
    kind: 'progress',
    value: true,
    completedAt: timestamp,
  };
  const { calls, transport } = fixture({
    data: {
      userId: 'alice',
      operationId: 'complete',
      revision: '3',
      value: true,
      completedAt: timestamp,
    },
    error: null,
  });

  assert.equal((await transport.send(operation)).completedAt, timestamp);
  assert.equal(calls[0].args.p_completed_at, timestamp);
  const snapshot = fixture({
    data: {
      userId: 'alice',
      items: [{ topicId: 'topic', kind: 'progress', completedAt: timestamp }],
      nextCursor: null,
    },
    error: null,
  });
  assert.equal((await snapshot.transport.snapshot('alice', null)).items[0].completedAt, timestamp);
  const invalid = fixture({
    data: {
      userId: 'alice',
      changes: [{ topicId: 'topic', kind: 'progress', value: true, revision: '1' }],
      hasMore: false,
    },
    error: null,
  });
  await assert.rejects(invalid.transport.changes('alice', '0'), /completion time/);
});

test('accepts only account-bound unavailable-topic rejections for positive operations', async () => {
  const operation = {
    userId: 'alice',
    operationId: 'operation',
    deviceId: 'device',
    sequence: '1',
    acknowledgedSequence: '0',
    topicId: 'topic',
    kind: 'like',
    value: true,
    completedAt: null,
  };
  const response = {
    data: {
      userId: 'alice',
      operationId: 'operation',
      status: 'rejected',
      reason: 'topic_unavailable',
    },
    error: null,
  };
  assert.deepEqual(await fixture(response).transport.send(operation), {
    userId: 'alice',
    operationId: 'operation',
    status: 'rejected',
    reason: 'topic_unavailable',
  });

  await assert.rejects(
    fixture(response).transport.send({ ...operation, value: false }),
    /rejection/
  );
  await assert.rejects(
    fixture({ data: { ...response.data, userId: 'bob' }, error: null }).transport.send(operation),
    /account/
  );
  await assert.rejects(
    fixture({ data: { ...response.data, reason: 'unknown' }, error: null }).transport.send(
      operation
    ),
    /rejection/
  );
});

test('validates reset requests for expired activity cursors', async () => {
  const response = {
    data: { userId: 'alice', changes: [], hasMore: false, resetRequired: true },
    error: null,
  };
  assert.deepEqual(await fixture(response).transport.changes('alice', '10'), response.data);
  await assert.rejects(
    fixture({ data: { ...response.data, hasMore: true }, error: null }).transport.changes(
      'alice',
      '10'
    ),
    /changes/
  );
  await assert.rejects(
    fixture({ data: { ...response.data, resetRequired: 'true' }, error: null }).transport.changes(
      'alice',
      '10'
    ),
    /changes/
  );
});
