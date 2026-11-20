import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiledDataUrl(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  if (output.includes("from './analytics-consent'")) {
    const consentSource = await readFile(new URL('../src/lib/analytics-consent.ts', import.meta.url), 'utf8');
    const consentCode = ts.transpileModule(consentSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const consentUrl = 'data:text/javascript;base64,' + Buffer.from(consentCode).toString('base64');
    output = output.replaceAll("from './analytics-consent'", `from '${consentUrl}'`);
  }
  return 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
}

const analyticsUrl = await transpiledDataUrl('../src/lib/feed-analytics-client.ts');
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  localStorage: {
    getItem(key) {
      if (key.includes('.account.')) return JSON.stringify({
        version: 1, serviceImprovement: true, sponsorMeasurement: true,
        updatedAt: '2026-11-20T12:00:00.000Z',
      });
      return null;
    },
  },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
const analytics = await import(analyticsUrl);

test('queues events separately for each signed-in account in memory', async () => {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  analytics.recordFeedAnalyticsEvent('account-a', 'impression', 'topic-one', { source: 'feed' });
  analytics.recordFeedAnalyticsEvent('account-b', 'impression', 'topic-two', { source: 'feed' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedAnalytics('account-a');
  await analytics.flushFeedAnalytics('account-b');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].events[0].entity_id, 'topic-one');
  assert.equal(calls[1].events[0].entity_id, 'topic-two');
  assert.equal('user_id' in calls[0].events[0], false);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});

test('bounds the in-memory queue while retaining the most recent events', async () => {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  for (let index = 0; index < 225; index += 1) {
    analytics.recordFeedAnalyticsEvent('bounded-account', 'swipe_depth', 'topic-one', {
      depth: index % 20, slide_index: index % 20,
    });
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedAnalytics('bounded-account');
  const events = calls.flatMap((call) => call.events);
  assert.equal(events.length, 200);
  assert.equal(events[0].metadata.depth, 5);
  assert.equal(events.at(-1).metadata.depth, 4);
});

test('flushes a bounded batch and removes acknowledged event IDs from memory', async () => {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  analytics.recordFeedAnalyticsEvent('flush-account', 'impression', 'topic-one');
  analytics.recordFeedAnalyticsEvent('flush-account', 'completion', 'topic-two');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedAnalytics('flush-account');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].events.length, 2);
  await analytics.flushFeedAnalytics('flush-account');
  assert.equal(calls.length, 1);
});

test('uses the authenticated remote API transport for native applications', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  analytics.recordFeedAnalyticsEvent('native-account', 'impression', 'topic-native');
  analytics.installFeedAnalyticsListeners('native-account', {
    endpoint: 'https://www.cathoscroll.com/api/analytics/feed-events',
    getAccessToken: async () => 'native-access-token',
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedAnalytics('native-account');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://www.cathoscroll.com/api/analytics/feed-events');
  assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer native-access-token');
  assert.equal(requests[0].options.credentials, 'omit');
});

test('topic visits and completions remain deduplicated across viewer unmounts', async () => {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    analytics.recordFeedTopicVisit('session-account', 'topic-revisited');
    now += 101;
    analytics.recordFeedTopicVisit('session-account', 'topic-revisited');
    analytics.recordFeedTopicCompletion('session-account', 'topic-completed', 4);
    analytics.recordFeedTopicCompletion('session-account', 'topic-completed', 4);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await analytics.flushFeedAnalytics('session-account');
    const events = calls.flatMap((call) => call.events);
    assert.deepEqual(events.map((event) => event.event_type), ['impression', 'impression', 'return_visit', 'completion']);
    assert.equal(events.at(-1).metadata.slide_index, 4);
    assert.equal(events.at(-1).metadata.completion_percent, 100);
  } finally {
    Date.now = originalNow;
  }
});
