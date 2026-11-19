import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/components/topic/', import.meta.url);
const [gesture, topicViewer, interstitial, sharedViewport, comments, sponsor] = await Promise.all([
  readFile(new URL('useTopicSwipeGesture.ts', root), 'utf8'),
  readFile(new URL('TopicSwipeViewer.tsx', root), 'utf8'),
  readFile(new URL('FeedInterstitialMotion.tsx', root), 'utf8'),
  readFile(new URL('FeedSwipeViewport.tsx', root), 'utf8'),
  readFile(new URL('TopCommentFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorFeedCard.tsx', root), 'utf8'),
]);

test('topic, comment and sponsor cards delegate to the same swipe viewport and gesture engine', () => {
  assert.match(topicViewer, /import \{ FeedSwipeViewport \} from '\.\/FeedSwipeViewport'/);
  assert.match(interstitial, /import \{ FeedSwipeViewport \} from '\.\/FeedSwipeViewport'/);
  assert.match(sharedViewport, /useTopicSwipeGesture/);
  assert.match(gesture, /stiffness: 1800, damping: 120/);
  assert.match(gesture, /window\.innerWidth \* 0\.07/);
  assert.match(gesture, /window\.innerHeight \* 0\.07/);
  assert.match(gesture, /velocityX > 25/);
  assert.match(gesture, /velocityY > 25/);
  assert.match(gesture, /now - lastTapRef\.current < 300/);
  assert.match(gesture, /setPointerCapture\(event\.pointerId\)/);
  assert.match(gesture, /window\.addEventListener\('keydown', handleKeyDown\)/);
  for (const source of [topicViewer, interstitial]) {
    assert.doesNotMatch(source, /const handlePointerDown =/);
    assert.doesNotMatch(source, /const handlePointerMove =/);
    assert.doesNotMatch(source, /const handlePointerUp =/);
  }
});

test('all three card types use the same five-position preview renderer', () => {
  for (const position of [/left-\[-100%\]/, /left-\[100%\]/, /top-\[-100%\]/, /top-\[100%\]/]) {
    assert.match(sharedViewport, position);
  }
  for (const slot of ['topPreview=', 'leftPreview=', 'rightPreview=', 'bottomPreview=']) {
    assert.ok(topicViewer.includes(slot), `topic viewer missing ${slot}`);
  }
  assert.match(interstitial, /leftPreview=\{previousHorizontalPreview\}/);
  assert.match(interstitial, /rightPreview=\{nextHorizontalPreview\}/);
  assert.match(comments, /previousHorizontalPreview=\{renderCommentPreview/);
  assert.match(comments, /nextHorizontalPreview=\{renderCommentPreview/);
  assert.match(sponsor, /previousHorizontalPreview=\{renderCampaignPreview/);
  assert.match(sponsor, /nextHorizontalPreview=\{renderCampaignPreview/);
});
