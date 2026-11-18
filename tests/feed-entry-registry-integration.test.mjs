import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [core, registry, cursor] = await Promise.all([
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/feed-card-registry.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-entry-cursor.ts', import.meta.url), 'utf8'),
]);

test('feed core delegates card rendering to the registry instead of importing card components', () => {
  assert.match(core, /createFeedCardRegistry\(feedCardRendererContext\)/);
  assert.match(core, /renderRegisteredFeedEntry\(activeFeedCardEntry, feedCardRenderers, feedCardRendererContext\)/);
  assert.doesNotMatch(core, /from ['"]\.\/TopCommentFeedCard['"]/);
  assert.doesNotMatch(core, /from ['"]\.\/SponsorFeedCard['"]/);
  assert.doesNotMatch(core, /from ['"]\.\/SponsorLoadingCard['"]/);
});

test('card renderer registrations own the component selection and receive shared navigation actions', () => {
  assert.match(registry, /registerFeedEntry<Extract<FeedEntry, \{ type: 'top-comments' \}>/);
  assert.match(registry, /registerFeedEntry<Extract<FeedEntry, \{ type: 'sponsor' \}>/);
  assert.match(registry, /onNext: context\.onNext/);
  assert.match(registry, /onPrevious: context\.onPrevious/);
  assert.match(registry, /entry\.status === 'pending'/);
});

test('ordered cursor traversal is shared by feed navigation', () => {
  assert.match(core, /flattenFeedEntryMap\(feedEntryMapRef\.current\)/);
  assert.match(core, /getAdjacentFeedEntry\(entries, currentKey, 'previous'\)/);
  assert.match(cursor, /export function getAdjacentFeedEntry/);
  assert.match(cursor, /export function reconcileFeedEntryCursor/);
});
