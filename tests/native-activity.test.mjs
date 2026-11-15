import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/activity.ts', import.meta.url), 'utf8');
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText
  .replace(
    /import \{\s*bootstrapActivity,?\s*\} from ['"]@\/lib\/offline\/activity-bootstrap['"];?/,
    'const bootstrapActivity = async () => {};'
  )
  .replace(
    "import { BackgroundActivitySync } from '@/lib/offline/activity-background-sync';",
    `class BackgroundActivitySync {
      constructor() {}
      setUser() {}
      requestSync() {}
      dispose() {}
    }`
  )
  .replace(
    /import \{\s*ActivityResetRequired,\s*OfflineActivitySync,?\s*\} from ['"]@\/lib\/offline\/activity-sync['"];?/,
    `class ActivityResetRequired extends Error {}
    class OfflineActivitySync {}`
  );
const { NativeActivity } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture() {
  const state = new Map();
  const writes = [];
  const store = {
    async isBootstrapped() {
      return true;
    },
    async getActivity(userId, topicId, kind) {
      return state.get(`${userId}:${topicId}:${kind}`) ?? null;
    },
    async setActivity(userId, topicId, kind, value, operationId) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.set(`${userId}:${topicId}:${kind}`, value);
      writes.push({ userId, topicId, kind, value, operationId });
    },
    async pendingCount() {
      return writes.length;
    },
  };
  const activity = new NativeActivity(
    'alice',
    store,
    {
      async send() {
        throw new Error('Not used in this test');
      },
      async head() {
        throw new Error('Not used in this test');
      },
      async snapshot() {
        throw new Error('Not used in this test');
      },
      async changes() {
        throw new Error('Not used in this test');
      },
    },
    () => {},
    () => false
  );
  return { activity, state, writes };
}

test('simultaneous progress completion requests create one queued operation', async () => {
  const { activity, writes } = fixture();
  try {
    await activity.start();
    await Promise.all([
      activity.set('topic-one', 'progress', true),
      activity.set('topic-one', 'progress', true),
      activity.set('topic-one', 'progress', true),
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].value, true);
  } finally {
    activity.dispose();
  }
});

test('rapid bookmark changes are serialized and preserve the final user action', async () => {
  const { activity, state, writes } = fixture();
  try {
    await activity.start();
    await Promise.all([
      activity.set('topic-one', 'bookmark', true),
      activity.set('topic-one', 'bookmark', false),
      activity.set('topic-one', 'bookmark', true),
    ]);
    assert.deepEqual(writes.map((write) => write.value), [true, false, true]);
    assert.equal(state.get('alice:topic-one:bookmark'), true);
  } finally {
    activity.dispose();
  }
});
