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
  assert.doesNotMatch(analytics, /queueLimit|slice\(-queueLimit\)/);
  assert.match(analytics, /flush\(\);/);
  assert.match(analytics, /window\.addEventListener\('online', flush\)/);
  assert.match(analytics, /if \(!response\.ok\) break/);
  assert.match(analytics, /latestQueue\.filter\(\(event\) => !acceptedIds\.has\(event\.event_id\)\)/);
});

test('sponsor analytics uses persistent stable-ID queue with reconnect and foreground retries', () => {
  assert.match(sponsor, /cathoscroll\.sponsor-events\.v1\./);
  assert.match(sponsor, /window\.localStorage\.setItem\(queueKey, JSON\.stringify\(queue\)\)/);
  assert.match(sponsor, /eventId: createEventId\(\)/);
  assert.match(sponsor, /window\.addEventListener\('online', flush\)/);
  assert.match(sponsor, /window\.addEventListener\('pageshow', flush\)/);
  assert.match(sponsor, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(sponsor, /if \(!response\.ok\) break/);
  assert.match(sponsor, /latest\.filter\(\(queued\) => queued\.eventId !== event\.eventId\)/);
});

test('README distinguishes measured analytics from current recommendation ranking inputs', () => {
  assert.match(readme, /does \*\*not\*\* currently use the raw feed analytics events/);
  assert.match(readme, /Native apps use the same authenticated analytics endpoint/);
  assert.match(readme, /Sponsor served events are recorded by the delivery API/);
});
