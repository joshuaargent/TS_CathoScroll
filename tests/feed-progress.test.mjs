import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/components/topic/', import.meta.url);
const [progress, topic, comments, sponsor, sponsorLoading, compatibility] = await Promise.all([
  readFile(new URL('FeedProgress.tsx', root), 'utf8'),
  readFile(new URL('TopicSwipeViewer.tsx', root), 'utf8'),
  readFile(new URL('TopCommentFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorLoadingCard.tsx', root), 'utf8'),
  readFile(new URL('TopicProgress.tsx', root), 'utf8'),
]);

test('every feed card type uses the original shared topic progress implementation', () => {
  assert.match(progress, /bg-border h-1 w-full overflow-hidden rounded-full/);
  assert.match(progress, /bg-accent h-full transition-all duration-300/);
  assert.match(progress, /const percentage = \(\(safeCurrent \+ 1\) \/ safeTotal\) \* 100/);

  for (const source of [topic, comments, sponsor, sponsorLoading]) {
    assert.match(source, /import \{ FeedProgress \} from '\.\/FeedProgress'/);
    assert.match(source, /<FeedProgress current=/);
  }

  assert.match(compatibility, /export \{ FeedProgress as TopicProgress \} from '\.\/FeedProgress'/);
});
