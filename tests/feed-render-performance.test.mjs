import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [homePage, recommendations, topicViewer] = await Promise.all([
  readFile(new URL('../src/app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/recommendations-server.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
]);

test('home feed streams a stable card shell while server authentication and recommendations resolve', () => {
  assert.ok(homePage.includes('<Suspense fallback={<HomeFeedLoading />}>'));
  assert.ok(homePage.includes('aria-busy="true"'));
  assert.ok(homePage.includes('Loading your feed'));
});

test('initial recommendation request is smaller while cursor pagination retains the full page size', () => {
  assert.ok(recommendations.includes('page_limit: cursor == null ? 24 : 50'));
});

test('topic previews use adjacent-entry gating without a delayed reveal or remount flash', () => {
  assert.ok(!topicViewer.includes('showEntryPreviews'));
  assert.ok(topicViewer.includes('previousEntryPreview !== null'));
  assert.ok(topicViewer.includes('nextEntryPreview !== null'));
  assert.ok(topicViewer.includes('nextEntryPreview === undefined'));
});
