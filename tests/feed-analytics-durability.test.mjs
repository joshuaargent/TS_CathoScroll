import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [analytics, sponsor, topicFeed, readme] = await Promise.all([
  readFile(new URL('../src/lib/feed-analytics-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
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

test('sponsor analytics queue survives a new sponsor placement within the same account', () => {
  assert.ok(sponsor.includes('cathoscroll.sponsor-events.v1.${userId}'));
  assert.ok(topicFeed.includes("userId={userId ?? ''}"));
  assert.ok(sponsor.includes('event.sessionId === sessionId'));
  assert.ok(sponsor.includes('window.localStorage.setItem(queueKey, JSON.stringify(queue))'));
  assert.ok(sponsor.includes('eventId: createEventId()'));
  assert.ok(sponsor.includes("window.addEventListener('online', flush)"));
  assert.ok(sponsor.includes("window.addEventListener('pageshow', flush)"));
  assert.ok(sponsor.includes("document.addEventListener('visibilitychange', onVisibilityChange)"));
  assert.ok(sponsor.includes('if (!response.ok) break'));
  assert.ok(sponsor.includes('latest.filter((queued) => queued.eventId !== event.eventId)'));
  assert.ok(sponsor.includes('previewMode'));
});

test('README documents bounded behavioural signals used by recommendation ranking', () => {
  assert.ok(readme.includes('bounded, decaying feed behaviour signals'));
  assert.ok(readme.includes('at least two distinct sessions'));
  assert.ok(readme.includes('Native apps use the same authenticated analytics endpoint'));
  assert.ok(readme.includes('Sponsor served events are recorded by the delivery API'));
});
