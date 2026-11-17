import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [commentSource, sponsorSource, feedCore, topicCard, topCommentCard, sponsorCard, topicViewer] = await Promise.all([
  readFile(new URL('../src/lib/feed-comments.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-campaigns.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
]);

async function importTypeScript(source) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const comments = await importTypeScript(commentSource);
const sponsors = await importTypeScript(sponsorSource);

test('Top Comments is due every five topic advances and sponsors every ten', () => {
  let commentCadence = 0;
  let sponsorCadence = 0;
  const commentDueAt = [];
  const sponsorDueAt = [];

  for (let advance = 1; advance <= 30; advance += 1) {
    if (comments.shouldInsertTopCommentCard(commentCadence, true)) commentDueAt.push(advance);
    if (sponsors.shouldInsertSponsorCard(sponsorCadence, true)) sponsorDueAt.push(advance);
    commentCadence = comments.getNextTopCommentCadence(commentCadence);
    sponsorCadence = sponsors.getNextSponsorCadence(sponsorCadence);
  }

  assert.deepEqual(commentDueAt, [5, 10, 15, 20, 25, 30]);
  assert.deepEqual(sponsorDueAt, [10, 20, 30]);
});

test('missing inventory suppresses only its own card schedule', () => {
  assert.equal(comments.shouldInsertTopCommentCard(4, false), false);
  assert.equal(sponsors.shouldInsertSponsorCard(9, false), false);
  assert.equal(comments.shouldInsertTopCommentCard(4, true), true);
  assert.equal(sponsors.shouldInsertSponsorCard(9, true), true);
});

test('the tenth-topic collision queues both cards without advancing a topic between them', () => {
  assert.match(feedCore, /const chooseSponsor = sponsorDue && !commentDue/);
  assert.match(feedCore, /pendingSponsorAfterComment\.current = sponsorDue/);
  assert.match(feedCore, /setTopicsSinceSponsorCard\(sponsorDue \? currentSponsorCadence : nextSponsorCadence\)/);
  assert.match(feedCore, /if \(!pendingSponsorAfterComment\.current\)/);
  assert.match(feedCore, /pendingSponsorAfterComment\.current = false/);
  assert.match(feedCore, /setShowSponsorCard\(true\)/);
  assert.doesNotMatch(feedCore, /lastInterstitialType/);
});

test('sponsor fetches cannot race feed navigation or account changes', () => {
  assert.match(feedCore, /sponsorRequestVersion/);
  assert.match(feedCore, /sponsorRequestPreviousCadence/);
  assert.match(feedCore, /sponsorRequestVersion\.current !== requestVersion/);
  assert.match(feedCore, /sponsorRequestVersion\.current \+= 1/);
  const previousTopic = feedCore.slice(feedCore.indexOf('const previousTopic ='));
  assert.match(previousTopic, /pendingSponsorAfterComment\.current = false/);
  assert.match(feedCore, /<TopCommentFeedCard\s+key=\{userId \?\? 'anonymous'\}/);
});


test('interstitial navigation is one-shot across swipe, keyboard, and button inputs', () => {
  for (const source of [topCommentCard, sponsorCard]) {
    assert.match(source, /const navigationStarted = useRef\(false\)/);
    assert.match(source, /if \(navigationStarted\.current\) return/);
    assert.match(source, /navigationStarted\.current = true/);

    const pointerHandler = source.match(/const handlePointerUp = \(event: PointerEvent<[\s\S]*?\n  };/);
    const keyboardHandler = source.match(/const handleKeyDown = \(event: KeyboardEvent<[\s\S]*?\n  };/);
    assert.ok(pointerHandler, 'pointer handler exists');
    assert.ok(keyboardHandler, 'keyboard handler exists');
    assert.match(pointerHandler[0], /navigateNextTopic\(\)/);
    assert.match(pointerHandler[0], /navigatePreviousTopic\(\)/);
    assert.match(keyboardHandler[0], /navigateNextTopic\(\)/);
    assert.match(keyboardHandler[0], /navigatePreviousTopic\(\)/);
    assert.match(source, /onClick=\{navigateNextTopic\}/);
    assert.match(source, /onClick=\{navigatePreviousTopic\}/);
  }
  assert.match(topicViewer, /const animationLockRef = useRef\(false\)/);
  assert.match(topicViewer, /if \(animationLockRef\.current\) return/);
  assert.match(topicViewer, /animationLockRef\.current = true/);
  assert.match(topicViewer, /animationLockRef\.current = false/);
});
test('top comment card follows the topic-card layout and opens the comment in-place', () => {
  assert.match(topicCard, /flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8/);
  assert.match(topicCard, /bg-accent-light\\/5/);
  assert.match(topCommentCard, /flex h-full min-h-0 w-full flex-col px-6 py-6 md:px-8 md:py-8/);
  assert.match(topCommentCard, /safeIndex === 0 && 'bg-accent-light\\/5'/);
  assert.match(topCommentCard, /<Heart/);
  assert.match(topCommentCard, /<MessageCircle/);
  assert.match(topCommentCard, /<DoorOpen/);
  assert.match(topCommentCard, /onDoubleClick=\\{/);
  assert.match(topCommentCard, /href=\\{\`\\/profile\\//);
  assert.doesNotMatch(topCommentCard, /Open discussion/);
  assert.doesNotMatch(topCommentCard, /<Button/);
});
