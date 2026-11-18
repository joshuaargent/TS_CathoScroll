import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';


async function importTypeScript(relativePath, instance = '') {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(output).toString('base64');
  return import('data:text/javascript;base64,' + encoded + (instance ? '#' + instance : ''));
}

const [analytics, sponsor, sponsorAnalytics, topicFeed, readme, sponsorClient, sync, layout, nativeMain] = await Promise.all([
  readFile(new URL('../src/lib/feed-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
  importTypeScript('../src/lib/sponsor-analytics-client.ts'),
  readFile(new URL('../src/components/providers/SponsorAnalyticsSync.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../native/main.tsx', import.meta.url), 'utf8'),
]);

test('feed analytics retains queued events until server acknowledgement and drains on startup', () => {
  assert.ok(analytics.includes('const queueLimit = 200;'));
  assert.ok(analytics.includes('if (queue.length >= queueLimit) return;'));
  assert.ok(analytics.includes('Preserve the oldest unacknowledged events'));
  assert.ok(analytics.includes('flush();'));
  assert.ok(analytics.includes("window.addEventListener('online', flush)"));
  assert.ok(analytics.includes('if (!response.ok) break'));
  assert.ok(analytics.includes('latestQueue.filter((event) => !acceptedIds.has(event.event_id))'));
});

test('sponsor analytics queue survives restarts and flushes even when no sponsor card is visible', () => {
  assert.ok(sponsorAnalytics.includes('cathoscroll.sponsor-events.v1.'));
  assert.ok(sponsorAnalytics.includes('latest.filter((queued) => queued.eventId !== eventId)'));
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
  assert.ok(nativeMain.includes('getAccessToken={getNativeSponsorAccessToken}'));
  assert.ok(topicFeed.includes("new URL('/api/content/sponsored-campaigns', effectiveSponsorApiBaseUrl)"));
  assert.ok(topicFeed.includes("window.location.protocol === 'capacitor:'"));
  assert.ok(sponsorAnalytics.includes("new URL('/api/content/sponsor-campaign-events', apiBaseUrl)"));
  assert.ok(topicFeed.includes("userId={userId ?? ''}"));
  assert.ok(sponsor.includes('recordSponsorCampaignEvent('));
  assert.ok(sponsor.includes('previewMode'));
  assert.ok(sponsorAnalytics.includes('queued.sessionId === event.sessionId'));
});

test('README documents bounded behavioural signals used by recommendation ranking', () => {
  assert.ok(readme.includes('bounded, decaying feed behaviour signals'));
  assert.ok(readme.includes('at least two distinct sessions'));
  assert.ok(readme.includes('Native apps use the same authenticated analytics endpoint'));
  assert.ok(readme.includes('Sponsor served events are recorded by the delivery API'));
});

test('sponsor events survive a failed send and are retried with the same IDs after restart', async () => {
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
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ recorded: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const userId = 'sponsor-queue-restart-test';
    const event = {
      campaignId: 'campaign-1',
      eventId: 'event-stable-1',
      sessionId: 'placement-session-1',
      eventType: 'viewable_impression',
    };
    assert.equal(
      sponsorClient.recordSponsorCampaignEvent(userId, event, async () => 'token'),
      true
    );
    assert.equal(
      JSON.parse(values.get('cathoscroll.sponsor-events.v1.' + userId)).length,
      1
    );

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
    await sponsorClient.flushSponsorCampaignEvents(userId, async () => 'token');
    assert.equal(
      JSON.parse(values.get('cathoscroll.sponsor-events.v1.' + userId))[0].eventId,
      'event-stable-1'
    );

    const restartedClient = await importTypeScript(
      '../src/lib/sponsor-analytics-client.ts',
      'after-restart'
    );
    await restartedClient.flushSponsorCampaignEvents(userId, async () => 'token');

    assert.deepEqual(requests.map((request) => request.eventId), [
      'event-stable-1',
      'event-stable-1',
    ]);
    assert.equal(values.has('cathoscroll.sponsor-events.v1.' + userId), false);
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
  const values = new Map();
  const sent = [];

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
    assert.equal(values.has('cathoscroll.sponsor-events.v1.' + userId), false);
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
