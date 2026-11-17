import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [analytics, sponsor, sponsorAnalytics, topicFeed, readme] = await Promise.all([
  readFile(new URL('../src/lib/feed-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

test('feed analytics retains queued events until server acknowledgement and drains on startup', () => {
  assert.ok(!analytics.includes('queueLimit'));
  assert.ok(analytics.includes('flush();'));
  assert.ok(analytics.includes("window.addEventListener('online', flush)"));
  assert.ok(analytics.includes('if (!response.ok) break'));
  assert.ok(analytics.includes('latestQueue.filter((event) => !acceptedIds.has(event.event_id))'));
});

test('sponsor analytics queue survives restarts and flushes even when no sponsor card is visible', () => {
  assert.ok(sponsorAnalytics.includes('cathoscroll.sponsor-events.v1.'));
  assert.ok(sponsorAnalytics.includes('latest.filter((queued) => queued.eventId !== event.eventId)'));
  assert.ok(sponsorAnalytics.includes("window.addEventListener('online', flush)"));
  assert.ok(sponsorAnalytics.includes("window.addEventListener('pageshow', flush)"));
  assert.ok(sponsorAnalytics.includes("document.addEventListener('visibilitychange', onVisibilityChange)"));
  assert.ok(sponsorAnalytics.includes('response.status === 400 || response.status === 403'));
  assert.ok(sponsorAnalytics.includes('Transient auth/rate/server'));
  assert.ok(sponsorAnalytics.includes('if (!response.ok)'));
  assert.ok(topicFeed.includes('installSponsorAnalyticsListeners(userId, getSponsorAccessToken, effectiveSponsorApiBaseUrl)'));
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
