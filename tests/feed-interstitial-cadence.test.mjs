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
  assert.match(topCommentCard, /navigationResetKey: string \| null/);
  assert.match(topCommentCard, /navigationStarted\.current = false;[\s\S]*?\[navigationResetKey\]/);
  assert.match(feedCore, /navigationResetKey=\{userId\}/);
  assert.match(topicViewer, /const animationLockRef = useRef\(false\)/);
  assert.match(topicViewer, /if \(animationLockRef\.current\) return/);
  assert.match(topicViewer, /animationLockRef\.current = true/);
  assert.match(topicViewer, /animationLockRef\.current = false/);
});
test('interstitial content uses the topic feed visual language rather than a separate card shell', () => {
  assert.match(topicCard, /mx-auto text-center/);
  assert.match(topCommentCard, /mx-auto w-full max-w-3xl text-center/);
  assert.match(sponsorCard, /mx-auto w-full max-w-3xl text-center/);
  assert.match(topCommentCard, /text-text-primary mx-auto max-w-3xl text-lg leading-relaxed md:text-xl/);
  assert.match(sponsorCard, /text-text-primary text-3xl leading-tight font-bold md:text-4xl/);
  assert.doesNotMatch(topCommentCard, /bg-bg-card border-border w-full rounded-3xl border/);
  assert.doesNotMatch(sponsorCard, /bg-bg-card border-border w-full overflow-hidden rounded-3xl border/);
});
