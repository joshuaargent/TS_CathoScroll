import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-analytics-client.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: false },
});
const analytics = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('queues events separately for each signed-in account', () => {
  analytics.recordFeedAnalyticsEvent('account-a', 'impression', 'topic-one', { source: 'feed' });
  analytics.recordFeedAnalyticsEvent('account-b', 'impression', 'topic-two', { source: 'feed' });

  const accountA = JSON.parse(storage.get('cathoscroll.feed-analytics.v1.account-a'));
  const accountB = JSON.parse(storage.get('cathoscroll.feed-analytics.v1.account-b'));

  assert.equal(accountA.length, 1);
  assert.equal(accountB.length, 1);
  assert.equal(accountA[0].entity_id, 'topic-one');
  assert.equal(accountB[0].entity_id, 'topic-two');
  assert.equal('user_id' in accountA[0], false);
});

test('bounds the persistent client queue to 200 events', () => {
  for (let index = 0; index < 225; index += 1) {
    analytics.recordFeedAnalyticsEvent('bounded-account', 'swipe_depth', 'topic-one', {
      depth: index % 20,
      slide_index: index % 20,
    });
  }

  const queue = JSON.parse(storage.get('cathoscroll.feed-analytics.v1.bounded-account'));
  assert.equal(queue.length, 200);
});

test('flushes a bounded batch and removes only acknowledged event IDs', async () => {
  analytics.recordFeedAnalyticsEvent('flush-account', 'impression', 'topic-one');
  analytics.recordFeedAnalyticsEvent('flush-account', 'completion', 'topic-two');

  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ accepted: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });

  await analytics.flushFeedAnalytics('flush-account');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].events.length, 2);
  assert.equal(storage.has('cathoscroll.feed-analytics.v1.flush-account'), false);
  assert.equal(storage.has('cathoscroll.feed-analytics.v1.account-a'), true);
});
