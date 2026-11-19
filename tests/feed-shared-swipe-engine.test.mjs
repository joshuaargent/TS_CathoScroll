import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/components/topic/', import.meta.url);
const [gesture, topicViewer, interstitial, comments, sponsor] = await Promise.all([
  readFile(new URL('useTopicSwipeGesture.ts', root), 'utf8'),
  readFile(new URL('TopicSwipeViewer.tsx', root), 'utf8'),
  readFile(new URL('FeedInterstitialMotion.tsx', root), 'utf8'),
  readFile(new URL('TopCommentFeedCard.tsx', root), 'utf8'),
  readFile(new URL('SponsorFeedCard.tsx', root), 'utf8'),
]);

test('topic cards and feed interstitials share the original topic swipe gesture engine', () => {
  assert.match(topicViewer, /import \{ useTopicSwipeGesture \} from '\.\/useTopicSwipeGesture'/);
  assert.match(interstitial, /import \{ useTopicSwipeGesture \} from '\.\/useTopicSwipeGesture'/);
  assert.match(gesture, /stiffness: 1800, damping: 120/);
  assert.match(gesture, /window\.innerWidth \* 0\.07/);
  assert.match(gesture, /window\.innerHeight \* 0\.07/);
  assert.match(gesture, /velocityX > 25/);
  assert.match(gesture, /velocityY > 25/);
  assert.match(gesture, /now - lastTapRef\.current < 300/);
  assert.match(gesture, /setPointerCapture\(event\.pointerId\)/);
  assert.doesNotMatch(topicViewer, /const handlePointerDown =/);
  assert.doesNotMatch(topicViewer, /const handlePointerMove =/);
  assert.doesNotMatch(topicViewer, /const handlePointerUp =/);
  assert.doesNotMatch(interstitial, /const handlePointerDown =/);
  assert.doesNotMatch(interstitial, /const handlePointerMove =/);
  assert.doesNotMatch(interstitial, /const handlePointerUp =/);
});

test('interstitials retain the same five-position preview stack as topic cards', () => {
  assert.match(topicViewer, /left-\[-100%\]/);
  assert.match(topicViewer, /left-\[100%\]/);
  assert.match(topicViewer, /top-\[-100%\]/);
  assert.match(topicViewer, /top-\[100%\]/);
  assert.match(interstitial, /left-\[-100%\]/);
  assert.match(interstitial, /left-\[100%\]/);
  assert.match(interstitial, /top-\[-100%\]/);
  assert.match(interstitial, /top-\[100%\]/);
  assert.match(comments, /previousHorizontalPreview=\{renderCommentPreview/);
  assert.match(comments, /nextHorizontalPreview=\{renderCommentPreview/);
  assert.match(sponsor, /previousHorizontalPreview=\{renderCampaignPreview/);
  assert.match(sponsor, /nextHorizontalPreview=\{renderCampaignPreview/);
});
