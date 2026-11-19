import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-card-analytics-client.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
}
const analytics = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('queues only supported Top Comments exposure events per account', () => {
  analytics.recordFeedCardAnalyticsEvent('account-a', 'impression', 42);
  analytics.recordFeedCardAnalyticsEvent('account-a', 'viewable_impression', 42);
  analytics.recordFeedCardAnalyticsEvent('account-b', 'open', 42);
  const a = JSON.parse(storage.get('cathoscroll:feed-card-analytics:v1:account-a'));
  const b = JSON.parse(storage.get('cathoscroll:feed-card-analytics:v1:account-b'));
  assert.deepEqual(a.map((event) => event.event_type), ['impression', 'viewable_impression']);
  assert.equal(a[0].card_type, 'top-comment');
  assert.equal(a[0].card_id, '42');
  assert.equal('user_id' in a[0], false);
  assert.equal(b.length, 1);
  assert.equal(b[0].event_type, 'open');
  for (const event of a) {
    assert.equal('like' in event, false);
    assert.equal('save' in event, false);
    assert.equal('share' in event, false);
  }
});

test('bounds the offline queue and retains the newest exposure events', () => {
  for (let id = 1; id <= 225; id += 1) {
    analytics.recordFeedCardAnalyticsEvent('bounded-account', 'active_duration', id, 5000);
  }
  const queue = JSON.parse(storage.get('cathoscroll:feed-card-analytics:v1:bounded-account'));
  assert.equal(queue.length, 200);
  assert.equal(queue[0].card_id, '26');
  assert.equal(queue.at(-1).card_id, '225');
});

test('flushes a bounded batch and removes acknowledged event IDs only', async () => {
  analytics.recordFeedCardAnalyticsEvent('flush-account', 'impression', 7);
  analytics.recordFeedCardAnalyticsEvent('flush-account', 'open', 7);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ accepted: 2 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedCardAnalytics('flush-account');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/analytics/feed-card-events');
  assert.equal(requests[0].body.events.length, 2);
  assert.equal(storage.has('cathoscroll:feed-card-analytics:v1:flush-account'), false);
});

test('Top Comments viewability requires half visibility for one continuous second', async () => {
  const card = await readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8');
  const route = await readFile(new URL('../src/app/api/analytics/feed-card-events/route.ts', import.meta.url), 'utf8');
  const hub = await readFile(new URL('../src/components/admin/AdminAnalyticsHub.tsx', import.meta.url), 'utf8');
  assert.ok(card.includes('ref={commentArticleRef}'));
  assert.ok(card.includes('scheduleViewability'));
  assert.ok(card.includes("document.visibilityState === 'hidden'"));
  assert.ok(card.includes('intersectionRatio >= 0.5'));
  assert.ok(card.includes('}, 1000)'));
  assert.ok(card.includes("'active_duration'"));
  assert.ok(card.includes("'skip'"));
  assert.ok(card.includes("'completion'"));
  assert.ok(card.includes("'open'"));
  assert.ok(route.includes("record_feed_card_analytics_events"));
  assert.match(hub, /\['overview','Overall'\].*\['categories','Categories'\].*\['topics','Topics'\].*\['sponsors','Sponsors'\].*\['comments','Comments'\]/s);
  assert.ok(hub.includes('Top Comments exposure'));
  assert.ok(hub.includes('Discussion open rate'));
  assert.ok(hub.includes('Comment active time'));
  assert.ok(hub.includes('Sponsor click-through'));
  assert.ok(hub.includes('Unique feed viewers'));
  assert.ok(hub.includes('Topic likes'));
  assert.ok(hub.includes('Completed topics'));
  const bootstrap = await readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8');
  assert.ok(bootstrap.toLowerCase().includes('delete from catho_private.feed_card_analytics_daily_viewers v using doomed d'));
  assert.ok(bootstrap.toLowerCase().includes('event_date<p_before::date'));
  assert.ok(!source.includes("'save'"));
  assert.ok(!source.includes("'share'"));
  assert.ok(!source.includes("'like'"));
});

test('uses the authenticated API endpoint and bearer token for native feed analytics', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  analytics.recordFeedCardAnalyticsEvent('native-account', 'impression', 81);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
  };
  const cleanup = analytics.installFeedCardAnalyticsListeners('native-account', {
    endpoint: 'https://www.cathoscroll.com/api/analytics/feed-card-events',
    getAccessToken: async () => 'native-access-token',
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedCardAnalytics('native-account');
  cleanup();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://www.cathoscroll.com/api/analytics/feed-card-events');
  assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer native-access-token');
  assert.equal(requests[0].options.credentials, 'omit');
});
