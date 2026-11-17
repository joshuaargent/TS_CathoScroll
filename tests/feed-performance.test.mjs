import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [viewer, feed] = await Promise.all([
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
]);

test('feed analytics listeners are installed once per active viewer rather than once per topic', () => {
  assert.ok(viewer.includes('return installFeedAnalyticsListeners(userId, {'));
  assert.ok(viewer.includes('}, [active, analyticsEndpoint, getAnalyticsAccessToken, userId])'));
  assert.ok(!viewer.includes('removeAnalyticsListeners()'));
  assert.ok(!viewer.includes('}, [currentTopicId, userId, active, analyticsEndpoint, getAnalyticsAccessToken])'));
});

test('top-comment refreshes coalesce in-flight requests and throttle repeated foreground events', () => {
  assert.ok(feed.includes('let requestInFlight: Promise<void> | null = null'));
  assert.ok(feed.includes('const refreshCooldownMs = 30_000'));
  assert.ok(feed.includes('if (requestInFlight) return requestInFlight'));
  assert.ok(feed.includes('if (Date.now() - lastAttemptAt < refreshCooldownMs)'));
  assert.ok(feed.includes('if (requestInFlight === request) requestInFlight = null'));
});
