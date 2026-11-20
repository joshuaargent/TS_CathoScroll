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

test('Top Comments inventory refreshes safely without replacing unrelated cached groups', () => {
  assert.ok(feed.includes("import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator'"));
  assert.ok(feed.includes('const refreshWhenVisible = () =>'));
  assert.ok(feed.includes('const refreshWhenOnline = () => void refresh.reconnect()'));
  assert.ok(feed.includes('void refresh.request()'));
  assert.ok(feed.includes('const commentsById = new Map('));
  assert.ok(feed.includes('const reconcileComments = (items: TopFeedComment[])'));
  assert.ok(feed.includes('topCommentCardsByTopicId.current.set(topicId, remainingComments)'));
  assert.ok(feed.includes('topCommentCardsByTopicId.current.delete(topicId)'));
  assert.ok(feed.includes('if (comments.length === 0)'));
});

test('feed analytics in-memory queue is bounded to the most recent 200 events per account', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body).events);
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const userId = 'bounded-feed-analytics-test';
    for (let index = 0; index < 250; index += 1) {
      analyticsModule.recordFeedAnalyticsEvent(userId, 'impression', 'topic-' + index);
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await analyticsModule.flushFeedAnalytics(userId);
    const queued = requests.flat();
    assert.equal(queued.length, 200);
    assert.equal(new Set(queued.map((event) => event.event_id)).size, 200);
    assert.equal(queued[0].entity_id, 'topic-50');
    assert.equal(queued.at(-1).entity_id, 'topic-249');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('final native reading-time events retain the authenticated transport through unmount cleanup', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = globalThis.fetch;
  const requests = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
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


test('feed topic visit attribution ignores StrictMode effect replays', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const requests = [];
  let now = 1000;
  Date.now = () => now;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body).events);
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const userId = 'strict-mode-feed-visit-test';
    analyticsModule.recordFeedTopicVisit(userId, 'topic-repeat');
    analyticsModule.recordFeedTopicVisit(userId, 'topic-repeat');
    now += 101;
    analyticsModule.recordFeedTopicVisit(userId, 'topic-repeat');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await analyticsModule.flushFeedAnalytics(userId);
    const queued = requests.flat();
    assert.equal(queued.filter((event) => event.event_type === 'impression').length, 2);
    assert.equal(queued.filter((event) => event.event_type === 'return_visit').length, 1);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
