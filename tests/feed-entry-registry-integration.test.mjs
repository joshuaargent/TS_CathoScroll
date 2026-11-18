import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [core, registry, cursor, placementRegistry, entryMap] = await Promise.all([
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/feed-card-registry.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-entry-cursor.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-card-placement-registry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-entry-map.ts', import.meta.url), 'utf8'),
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
  assert.match(registry, /onPrevious: context\.navigatePrevious/);
  assert.match(registry, /invokeRegisteredFeedEntryAction/);
  assert.match(registry, /entry\.status === 'pending'/);
});

test('card enter and exit lifecycles are registered beside their renderers', () => {
  assert.match(registry, /onEnter: \(entry/);
  assert.match(registry, /onExit: \(entry/);
  assert.match(core, /invokeRegisteredFeedEntryLifecycle/);
  assert.doesNotMatch(core, /if \(entry\.type === 'top-comments'\)/);
  assert.doesNotMatch(core, /if \(entry\.type === 'sponsor'\)/);
});

test('feed navigation no longer has separate comment and sponsor traversal handlers', () => {
  assert.match(core, /const navigateFeedEntry = async/);
  assert.doesNotMatch(core, /handleSponsorNext|handleSponsorPrevious|handleTopCommentNext|handleTopCommentPrevious/);
  assert.doesNotMatch(core, /topCommentIsPreviousEntry|sponsorIsPreviousEntry|sponsorPreviousIsComment|pendingSponsorAfterComment/);
});

test('placement rules are registered separately from the generic sequence builder', () => {
  assert.match(entryMap, /createFeedCardPlacementRules\(/);
  assert.match(placementRegistry, /export function createFeedCardPlacementRules/);
  assert.match(placementRegistry, /DEFAULT_FEED_CARD_RULES/);
  assert.match(placementRegistry, /createEntry: \(topic\) =>/);
  assert.match(entryMap, /buildOrderedFeedSequence<Topic, FeedCardEntry>/);
});

test('one active entry key replaces separate comment and sponsor visibility state', () => {
  assert.match(core, /const \[activeFeedEntryKey, setActiveFeedEntryKeyState\]/);
  assert.doesNotMatch(core, /showTopCommentCard|showSponsorCard|setShowTopCommentCard|setShowSponsorCard/);
  assert.match(core, /getFeedEntryKey\(entry\) === activeFeedEntryKey/);
});

test('ordered cursor traversal is shared by feed navigation', () => {
  assert.match(core, /flattenFeedEntryMap\(feedEntryMapRef\.current\)/);
  assert.match(core, /getAdjacentFeedEntry\(entries, currentKey, 'previous'\)/);
  assert.match(core, /getAdjacentFeedEntry\(entries, currentKey, 'next'\)/);
  assert.match(core, /const navigateFeedEntry = async/);
  assert.match(core, /await activateFeedEntry\(adjacent\.entry, direction, entries\)/);
  assert.match(core, /Future registered card types need only a placement rule and renderer/);
  assert.match(cursor, /export function getAdjacentFeedEntry/);
  assert.match(cursor, /export function reconcileFeedEntryCursor/);
});
