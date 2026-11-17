import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(output).toString('base64');
  return import('data:text/javascript;base64,' + encoded);
}

const [viewer, feed, coordinatorModule, analyticsModule] = await Promise.all([
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  importTypeScript('../src/lib/feed-refresh-coordinator.ts'),
  importTypeScript('../src/lib/feed-analytics-client.ts'),
]);

test('feed analytics listeners are installed once per active viewer rather than once per topic', () => {
  assert.ok(viewer.includes('return installFeedAnalyticsListeners(userId, {'));
  assert.ok(viewer.includes('}, [active, analyticsEndpoint, getAnalyticsAccessToken, userId])'));
  assert.ok(!viewer.includes('removeAnalyticsListeners()'));
  assert.ok(!viewer.includes('}, [currentTopicId, userId, active, analyticsEndpoint, getAnalyticsAccessToken])'));
});

test('feed refresh coordinator coalesces overlapping requests and enforces its cooldown', async () => {
  let now = 1_000;
  let resolveFirst;
  let calls = 0;
  const coordinator = coordinatorModule.createFeedRefreshCoordinator(
    () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(true);
    },
    30_000,
    () => now
  );

  const first = coordinator.request();
  const duplicate = coordinator.request();
  assert.equal(calls, 1);
  resolveFirst(true);
  await Promise.all([first, duplicate]);

  now += 29_999;
  await coordinator.request();
  assert.equal(calls, 1);

  now += 1;
  await coordinator.request();
  assert.equal(calls, 2);
  coordinator.dispose();
});

test('reconnect retries once when it overlaps a failed in-flight refresh', async () => {
  let resolveFirst;
  let calls = 0;
  const coordinator = coordinatorModule.createFeedRefreshCoordinator(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve(true);
  });

  const initial = coordinator.request();
  const reconnect = coordinator.reconnect();
  assert.equal(calls, 1);
  resolveFirst(false);
  await Promise.all([initial, reconnect]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  coordinator.dispose();
});

test('Top Comments inventory is frozen after its first successful load', () => {
  assert.ok(feed.includes("import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator'"));
  assert.ok(feed.includes('let inventoryInitialized = false;'));
  assert.ok(feed.includes('if (inventoryInitialized) return true;'));
  assert.ok(feed.includes('if (!inventoryInitialized) void refresh.reconnect()'));
  assert.ok(feed.includes('if (!inventoryInitialized && document.visibilityState === \'visible\')'));
  assert.ok(feed.includes('inventoryInitialized = true;'));
  assert.ok(feed.includes('setTopComments(comments);'));
  assert.ok(feed.includes('void refresh.request()'));
});

test('final native reading-time events retain the authenticated transport through unmount cleanup', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = globalThis.fetch;
  const values = new Map();
  const requests = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
  });
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get('Authorization') });
    return new Response(null, { status: 200 });
  };

  try {
    const userId = 'native-final-duration-test';
    const cleanup = analyticsModule.installFeedAnalyticsListeners(userId, {
      endpoint: 'https://cathoscroll.example/api/analytics/feed-events',
      getAccessToken: async () => 'native-session-token',
    });

    // React cleans up the stable listener effect before the topic-duration
    // effect. The final duration is recorded synchronously in that same turn.
    cleanup();
    analyticsModule.recordFeedAnalyticsEvent(userId, 'active_duration', 'topic-1', {
      duration_ms: 2_500,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://cathoscroll.example/api/analytics/feed-events');
    assert.equal(requests[0].authorization, 'Bearer native-session-token');
    assert.equal(values.has('cathoscroll.feed-analytics.v1.' + userId), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
});
