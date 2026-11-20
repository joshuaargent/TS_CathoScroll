import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';


async function transpiledDataUrl(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  if (output.includes("from './analytics-consent'")) {
    const consentUrl = await transpiledDataUrl('../src/lib/analytics-consent.ts');
    output = output.replaceAll("from './analytics-consent'", `from '${consentUrl}'`);
  }
  return 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
}

async function importTypeScript(relativePath, instance = '') {
  const url = await transpiledDataUrl(relativePath);
  return import(url + (instance ? '#' + instance : ''));
}

function createTestWindow() {
  return {
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem(key) {
        if (key.includes('.account.')) {
          return JSON.stringify({
            version: 1,
            serviceImprovement: true,
            sponsorMeasurement: true,
            updatedAt: '2026-11-20T12:00:00.000Z',
          });
        }
        return null;
      },
      setItem() {},
    },
  };
}


const [analytics, sponsor, sponsorAnalytics, topicFeed, cardRegistry, readme, sponsorClient, sync, layout, nativeMain, bootstrap, anonymousAnalytics, sponsorSync, cardAnalytics, anonymousOutbox, signedInOutbox] = await Promise.all([
  readFile(new URL('../src/lib/feed-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/feed-card-registry.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
  importTypeScript('../src/lib/sponsor-analytics-client.ts'),
  readFile(new URL('../src/components/providers/SponsorAnalyticsSync.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../native/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/anonymous-feed-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/providers/SponsorAnalyticsSync.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-card-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/offline/anonymous-analytics-store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/offline/signed-in-analytics-store.ts', import.meta.url), 'utf8'),
]);


test('signed-out topic/comment analytics uses a durable native outbox and a bounded web memory queue', () => {
  assert.ok(anonymousAnalytics.includes('const pendingEvents: AnonymousFeedAnalyticsEvent[] = [];'));
  assert.ok(anonymousAnalytics.includes('configureAnonymousFeedAnalyticsOutbox'));
  assert.ok(anonymousAnalytics.includes('persistentOutbox.pending(40)'));
  assert.ok(anonymousAnalytics.includes('setAnonymousFeedAnalyticsEnabled'));
  assert.ok(anonymousAnalytics.includes('anonymousAnalyticsPreferenceKey'));
  assert.ok(anonymousAnalytics.includes("window.addEventListener('online'"));
  assert.ok(anonymousAnalytics.includes("window.addEventListener('pageshow'"));
  assert.doesNotMatch(anonymousAnalytics, /sessionStorage|indexedDB/);
  assert.ok(anonymousOutbox.includes('offline_anonymous_analytics_outbox'));
  assert.ok(anonymousOutbox.includes('maximumEvents = 2000'));
  assert.ok(anonymousOutbox.includes('maximumAgeMs = 7 * 24 * 60 * 60 * 1000'));
  assert.ok(anonymousOutbox.includes('INSERT OR IGNORE'));
  assert.ok(anonymousOutbox.includes('async clear()'));
  assert.doesNotMatch(anonymousOutbox, /user_id|session_id|visitor_id|account_id/i);
  assert.ok(analytics.includes('const pendingQueues = new Map'));
  assert.ok(cardAnalytics.includes('const pendingQueues = new Map'));
  assert.ok(signedInOutbox.includes('offline_signed_in_analytics_outbox'));
  assert.ok(sponsorAnalytics.includes('const pendingQueues = new Map'));
  assert.doesNotMatch(analytics + cardAnalytics + sponsorAnalytics, /localStorage|sessionStorage|indexedDB/);
  assert.ok(sponsorSync.includes('installAnonymousFeedAnalyticsSync();'));
  assert.ok(layout.includes('<SponsorAnalyticsSync />'));
  assert.ok(nativeMain.includes('<SponsorAnalyticsSync'));
});

test('anonymous sponsor event retries stay in memory and never persist the session token', () => {
  const anonymousQueueStart = sponsorAnalytics.indexOf('const anonymousQueue:');
  assert.ok(anonymousQueueStart >= 0);
  const anonymousQueueSource = sponsorAnalytics.slice(anonymousQueueStart);
  assert.match(anonymousQueueSource, /recordAnonymousSponsorCampaignEvent/);
  assert.match(anonymousQueueSource, /flushAnonymousSponsorCampaignEvents/);
  assert.match(anonymousQueueSource, /window\.addEventListener\('online'/);
  assert.doesNotMatch(anonymousQueueSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(sponsorSync, /installAnonymousSponsorAnalyticsListeners\(\)/);
  assert.match(sponsor, /recordAnonymousSponsorCampaignEvent/);
});

test('anonymous analytics receipts and sponsor session records use 30-day retention', () => {
  assert.match(bootstrap, /anonymous_sponsor_events[\s\S]*?interval '?30 days'?/);
  assert.match(bootstrap, /anonymous_sponsor_session_frequency[\s\S]*?interval '?30 days'?/);
  assert.match(bootstrap, /anonymous_feed_event_receipts[\s\S]*?interval '?30 days'?/);
});

test('signed-in feed and sponsor raw-event retention remains 180 days', () => {
  assert.match(bootstrap, /prune_feed_analytics_events\(statement_timestamp\(\) - interval ''180 days''/);
  assert.match(bootstrap, /prune_sponsor_campaign_events\(statement_timestamp\(\) - interval ''180 days''/);
});

test('feed analytics retains active-page events until server acknowledgement and retries on reconnect', () => {
  assert.ok(analytics.includes('const queueLimit = 200;'));
  assert.ok(analytics.includes('queue.splice(0, queue.length - queueLimit)'));
  assert.ok(analytics.includes("persistentOutbox.enqueue(userId, 'topic', event)"));
  assert.ok(analytics.includes('flush();'));
  assert.ok(analytics.includes("window.addEventListener('online', flush)"));
  assert.ok(analytics.includes('if (!response.ok) break'));
  assert.ok(analytics.includes("persistentOutbox.acknowledge(userId, 'topic', [...acceptedIds])"));
});

test('feed analytics retention cron uses the same statement timestamp as its retention validator', () => {
  assert.match(bootstrap, /prune_feed_analytics_events\(statement_timestamp\(\) - interval ''180 days'', 5000\)/);
  assert.doesNotMatch(bootstrap, /prune_feed_analytics_events\(clock_timestamp\(/);
});

test('sponsor analytics queue stays in memory and flushes without a visible sponsor card', () => {
  assert.ok(sponsorAnalytics.includes('const pendingQueues = new Map'));
  assert.doesNotMatch(sponsorAnalytics, /localStorage|sessionStorage|indexedDB/);
  assert.ok(sponsorAnalytics.includes('readQueue(userId).filter((queued) => queued.eventId !== eventId)'));
  assert.ok(sponsorAnalytics.includes("window.addEventListener('online', flush)"));
  assert.ok(sponsorAnalytics.includes("window.addEventListener('pageshow', flush)"));
  assert.ok(sponsorAnalytics.includes("document.addEventListener('visibilitychange', onVisibilityChange)"));
  assert.ok(sponsorAnalytics.includes('response.status === 400 || response.status === 403'));
  assert.ok(sponsorAnalytics.includes('Transient auth/rate/server'));
  assert.ok(sponsorAnalytics.includes('if (!response.ok)'));
  assert.ok(sync.includes('installSponsorAnalyticsListeners('));
  assert.ok(sync.includes('supabase.auth.onAuthStateChange'));
  assert.ok(layout.includes('<SponsorAnalyticsSync />'));
  assert.ok(nativeMain.includes('<SponsorAnalyticsSync'));
  assert.ok(nativeMain.includes('getAccessToken={getSponsorAccessToken}'));
  assert.ok(topicFeed.includes("new URL('/api/content/sponsored-campaigns', effectiveSponsorApiBaseUrl)"));
  assert.ok(topicFeed.includes("window.location.protocol === 'capacitor:'"));
  assert.ok(sponsorAnalytics.includes("new URL('/api/content/sponsor-campaign-events', apiBaseUrl)"));
  assert.ok(cardRegistry.includes("userId={context.userId}"));
  assert.ok(sponsor.includes('recordSponsorCampaignEvent('));
  assert.ok(sponsor.includes('previewMode'));
  assert.ok(sponsorAnalytics.includes('queued.sessionId === event.sessionId'));
});

test('README documents bounded behavioural signals used by recommendation ranking', () => {
  assert.ok(readme.includes('bounded, decaying feed behaviour signals'));
  assert.ok(readme.includes('at least two distinct sessions'));
  assert.ok(readme.includes('Native apps use the same shared feed components and API endpoints as the website'));
  assert.ok(readme.includes('Anonymous sponsor viewable/click events use a bounded in-memory retry queue'));
});

test('sponsor analytics bounds the in-memory queue and sends the retained events', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  const sent = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: createTestWindow() });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body).eventId);
    return new Response(null, { status: 200 });
  };
  try {
    const userId = 'bounded-sponsor-queue-test';
    for (let index = 0; index < 1005; index += 1) {
      sponsorClient.recordSponsorCampaignEvent(userId, {
        campaignId: 'campaign-' + index,
        eventId: 'event-' + index,
        sessionId: 'placement-' + index,
        eventType: 'viewable_impression',
      }, async () => 'token');
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');
    assert.equal(sent.length, 1000);
    assert.equal(sent[0], 'event-0');
    assert.equal(sent.at(-1), 'event-999');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('sponsor events remain retryable after a failed send within the active process', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = globalThis.fetch;
  const requests = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(null, { status: requests.length === 1 ? 503 : 200 });
  };
  try {
    const userId = 'sponsor-memory-retry-test';
    const event = { campaignId: 'campaign-1', eventId: 'event-stable-1', sessionId: 'placement-session-1', eventType: 'viewable_impression' };
    assert.equal(sponsorClient.recordSponsorCampaignEvent(userId, event, async () => 'token'), true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');
    assert.equal(requests.length, 1);
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.eventId), ['event-stable-1', 'event-stable-1']);
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');
    assert.equal(requests.length, 2);
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

test('expired sponsor placements are discarded without blocking later queued events', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = globalThis.fetch;
  const sent = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: createTestWindow(),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
  });
  globalThis.fetch = async (_url, init) => {
    const event = JSON.parse(init.body);
    sent.push(event.eventId);
    return new Response(null, { status: sent.length === 1 ? 403 : 200 });
  };

  try {
    const userId = 'sponsor-expired-event-test';
    sponsorClient.recordSponsorCampaignEvent(userId, {
      campaignId: 'campaign-expired',
      eventId: 'event-expired',
      sessionId: 'session-expired',
      eventType: 'viewable_impression',
    }, async () => 'token');
    sponsorClient.recordSponsorCampaignEvent(userId, {
      campaignId: 'campaign-current',
      eventId: 'event-current',
      sessionId: 'session-current',
      eventType: 'viewable_impression',
    }, async () => 'token');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');

    assert.deepEqual(sent, ['event-expired', 'event-current']);
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

test('Top Comments refresh uses the tested coordinator with an explicit reconnect retry', () => {
  assert.ok(topicFeed.includes("import { createFeedRefreshCoordinator } from '@/lib/feed-refresh-coordinator'"));
  assert.ok(topicFeed.includes('const refresh = createFeedRefreshCoordinator(async () => {'));
  assert.ok(topicFeed.includes('const refreshWhenOnline = () => void refresh.reconnect()'));
  assert.ok(topicFeed.includes('void refresh.request()'));
});


test('native signed-in topic and comment analytics use the encrypted private database outbox', () => {
  assert.match(signedInOutbox, /offline_signed_in_analytics_outbox/);
  assert.match(signedInOutbox, /maximumEventsPerStream = 2000/);
  assert.match(signedInOutbox, /maximumAgeMs = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(signedInOutbox, /stream IN \('topic', 'comment', 'sponsor'\)/);
  assert.match(signedInOutbox, /ALTER TABLE offline_signed_in_analytics_outbox RENAME TO offline_signed_in_analytics_outbox_v1/);
  assert.match(signedInOutbox, /PRIMARY KEY \(user_id, stream, event_id\)/);
  assert.match(signedInOutbox, /INSERT OR IGNORE/);
  assert.match(signedInOutbox, /acknowledge\(/);
  assert.match(signedInOutbox, /clearUser\(/);
  assert.match(nativeMain, /new NativeSignedInAnalyticsOutbox\(cacheDatabase\)/);
  assert.match(nativeMain, /configureFeedAnalyticsOutbox/);
  assert.match(nativeMain, /configureFeedCardAnalyticsOutbox/);
  assert.match(nativeMain, /configureSponsorAnalyticsOutbox/);
  assert.match(nativeMain, /clearFeedAnalyticsOutbox\(previousUserId\)/);
  assert.match(nativeMain, /clearFeedCardAnalyticsOutbox\(previousUserId\)/);
  assert.match(nativeMain, /clearSponsorAnalyticsOutbox\(previousUserId\)/);
  assert.match(sponsorAnalytics, /persistentOutbox\.enqueue\(userId, 'sponsor'/);
  assert.match(sponsorAnalytics, /persistentOutbox\.pending\(userId, 'sponsor', 1\)/);
  assert.match(sponsorAnalytics, /persistentOutbox\.acknowledge\(userId, 'sponsor', \[event\.eventId\]\)/);
  assert.match(sponsorAnalytics, /persistentOutbox\.pending\(userId, 'sponsor', 1\)/);
  assert.match(sponsorAnalytics, /persistentOutbox\.acknowledge\(userId, 'sponsor', \[event\.eventId\]\)/);
  assert.match(analytics, /persistentOutbox\.pending\(userId, 'topic', batchLimit\)/);
  assert.match(cardAnalytics, /persistentOutbox\.pending\(userId, 'comment', 50\)/);
});
