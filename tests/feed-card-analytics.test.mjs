import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-card-analytics-client.ts', import.meta.url), 'utf8');

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

const analyticsUrl = await transpiledDataUrl('../src/lib/feed-card-analytics-client.ts');
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
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
}
const analytics = await import(analyticsUrl);
test('queues only supported Top Comments exposure events per account without device storage', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ accepted: 2 }), { status: 200 });
  };
  analytics.recordFeedCardAnalyticsEvent('account-a', 'impression', 42);
  analytics.recordFeedCardAnalyticsEvent('account-a', 'viewable_impression', 42);
  analytics.recordFeedCardAnalyticsEvent('account-b', 'open', 42);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedCardAnalytics('account-a');
  await analytics.flushFeedCardAnalytics('account-b');
  const a = requests[0].body.events;
  const b = requests[1].body.events;
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
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});

test('bounds the in-memory queue and retains the newest exposure events', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body).events);
    return new Response(JSON.stringify({ accepted: 50 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  for (let id = 1; id <= 225; id += 1) {
    analytics.recordFeedCardAnalyticsEvent('bounded-account', 'active_duration', id, 5000);
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedCardAnalytics('bounded-account');
  const events = requests.flat();
  assert.equal(events.length, 200);
  assert.equal(events[0].card_id, '26');
  assert.equal(events.at(-1).card_id, '225');
});

test('flushes events and removes acknowledged event IDs from memory', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ accepted: 2 }), { status: 200 });
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  analytics.recordFeedCardAnalyticsEvent('flush-account', 'impression', 7);
  analytics.recordFeedCardAnalyticsEvent('flush-account', 'open', 7);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await analytics.flushFeedCardAnalytics('flush-account');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/analytics/feed-card-events');
  assert.equal(requests[0].body.events.length, 2);
  await analytics.flushFeedCardAnalytics('flush-account');
  assert.equal(requests.length, 1);
});

test('Top Comments viewability requires half visibility for one continuous second', async () => {
  const card = await readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8');
  const route = await readFile(new URL('../src/app/api/analytics/feed-card-events/route.ts', import.meta.url), 'utf8');
  const hub = await readFile(new URL('../src/components/admin/AdminAnalyticsHub.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../src/app/admin/analytics/[kind]/[id]/page.tsx', import.meta.url), 'utf8');
  assert.ok(card.includes('ref={commentArticleRef}'));
  assert.ok(card.includes('scheduleViewability'));
  assert.ok(card.includes('viewableImpressionRecorded'));
  assert.ok(card.includes("document.visibilityState === 'hidden'"));
  assert.ok(card.includes('intersectionRatio >= 0.5'));
  assert.ok(card.includes('}, 1000)'));
  assert.ok(card.includes("'active_duration'"));
  assert.ok(card.includes("'skip'"));
  assert.ok(card.includes("'completion'"));
  assert.ok(card.includes("'open'"));
  assert.ok(route.includes("record_feed_card_analytics_events"));
  for (const section of ["value: 'overview', label: 'Overall'", "value: 'categories', label: 'Categories'", "value: 'topics', label: 'Topics'", "value: 'sponsors', label: 'Sponsors'", "value: 'comments', label: 'Comments'"]) assert.ok(hub.includes(section));
  assert.ok(hub.includes('Top Comments exposure'));
  assert.ok(hub.includes('DailyOverviewChart'));
  assert.ok(detail.includes('TrendChart'));
  assert.ok(detail.includes('/^\\d{1,18}$/'));
  assert.ok(detail.includes('Daily performance'));
  assert.ok(detail.includes(".gte('created_at', from.toISOString())"));
  assert.ok(hub.includes('Discussion open rate'));
  assert.ok(hub.includes('Comment active time'));
  assert.ok(hub.includes('Sponsor click-through'));
  assert.ok(hub.includes('Unique signed-in viewers'));
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
