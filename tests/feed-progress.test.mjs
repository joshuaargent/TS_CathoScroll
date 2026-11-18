import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/components/topic/', import.meta.url);
const [progress, topic, comments, sponsor, sponsorLoading, topicCard, layout, compatibility, feedCore] = await Promise.all([
  readFile(new URL('FeedProgress.tsx', root), 'utf8'),
  readFile(new URL('TopicSwipeViewer.tsx', root), 'utf8'),
  readFile(new URL('TopCommentFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorLoadingCard.tsx', root), 'utf8'),
  readFile(new URL('TopicCard.tsx', root), 'utf8'),
  readFile(new URL('TopicCardLayout.tsx', root), 'utf8'),
  readFile(new URL('TopicProgress.tsx', root), 'utf8'),
  readFile(new URL('TopicFeedCore.tsx', root), 'utf8'),
]);

test('every feed card type uses the original shared topic progress implementation', () => {
  assert.match(progress, /bg-border h-1 w-full overflow-hidden rounded-full/);
  assert.match(progress, /bg-accent h-full transition-all duration-300/);
  assert.match(progress, /const percentage = \(\(safeCurrent \+ 1\) \/ safeTotal\) \* 100/);
  assert.match(feedCore, /import \{ FeedProgress \} from '\.\/FeedProgress'/);
  assert.match(feedCore, /<FeedProgress current=\{feedProgress\.current\} total=\{feedProgress\.total\} \/>/);
  assert.match(feedCore, /className="shrink-0 px-6 pt-4"/);
  assert.match(topic, /onProgressChange\(slideIndex, slides\.length\)/);
  assert.match(comments, /onProgressChange\(safeIndex, comments\.length\)/);
  for (const source of [topic, comments, sponsor, sponsorLoading]) {
    assert.doesNotMatch(source, /<FeedProgress current=/);
  }

  assert.match(compatibility, /export \{ FeedProgress as TopicProgress \} from '\.\/FeedProgress'/);
});

test('shared progress is owned by the feed shell and is not remounted with individual cards', () => {
  assert.match(feedCore, /setFeedProgress\(\{ current, total \}\)/);
  assert.match(feedCore, /const updateFeedProgress = useCallback/);
  assert.match(feedCore, /onProgressChange=\{updateFeedProgress\}/);
  assert.match(feedCore, /setFeedProgress\(\{ current: 0, total: 1 \}\)/);
});

test('shared card layout preserves the original topic card and progress spacing', () => {
  assert.match(layout, /px-6 pt-4 pb-4/);
  assert.match(layout, /px-6 pt-6 pb-6 md:px-8 md:pt-8 md:pb-8/);
});

test('shared layout does not add a background to original topic cards', () => {
  assert.match(topicCard, /className="bg-transparent"/);
  assert.match(topicCard, /cardClassName=\{type === 'question' \? 'bg-accent-light\/5' : undefined\}/);
});
