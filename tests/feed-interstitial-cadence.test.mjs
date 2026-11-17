import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [commentSource, sponsorSource, feedCore, topicCard, topCommentCard, sponsorCard, topicViewer, interstitialMotion, topicCardLayout, topCommentsRoute, progressSource] = await Promise.all([
  readFile(new URL('../src/lib/feed-comments.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-campaigns.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/FeedInterstitialMotion.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicCardLayout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/content/top-comments/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicProgress.tsx', import.meta.url), 'utf8'),
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
  assert.match(feedCore, /sponsorPreviousIsComment/);
});


test('interstitial cards share the topic viewer swipe and animation model', () => {
  assert.match(interstitialMotion, /duration: 0\.2,[\s\S]*ease: 'easeOut'/);
  assert.match(interstitialMotion, /stiffness: 1800, damping: 120/);
  assert.match(interstitialMotion, /width \* 0\.07/);
  assert.match(interstitialMotion, /height \* 0\.07/);
  assert.match(interstitialMotion, /canSwipeLeft/);
  assert.match(interstitialMotion, /canSwipeRight/);
  assert.match(interstitialMotion, /window.addEventListener\('keydown', handleKeyDown\)/);
  for (const source of [topCommentCard, sponsorCard]) {
    assert.match(source, /<FeedInterstitialMotion/);
    assert.match(source, /onNextTopic=\{navigateNextTopic\}/);
    assert.match(source, /onPreviousTopic=\{navigatePreviousTopic\}/);
    assert.match(source, /<TopicCardLayout/);
  }
  assert.match(topicViewer, /const animationLockRef = useRef\(false\)/);
  assert.match(topicViewer, /duration: 0\.2/);
});
test('topic, comment and sponsor cards use the same structural layout component', () => {
  for (const source of [topicCard, topCommentCard, sponsorCard]) {
    assert.match(source, /<TopicCardLayout/);
  }
  assert.match(topicCardLayout, /flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8/);
  assert.match(topicCardLayout, /flex min-h-0 flex-1 items-center justify-center/);
  assert.match(topicCardLayout, /mx-auto w-full text-center/);
  assert.match(topicCardLayout, /flex items-center justify-between gap-3/);
  assert.match(topicCardLayout, /\{progress\}/);
  assert.match(topCommentCard, /<TopicProgress current=\{safeIndex\} total=\{comments\.length\} \/>/);
  assert.ok(topicCard.includes('bg-accent-light/5'));
  assert.ok(topCommentCard.includes('bg-accent-light/5'));
  assert.match(topCommentCard, /<Heart/);
  assert.match(topCommentCard, /<MessageCircle/);
  assert.match(topCommentCard, /<DoorOpen/);
  assert.match(sponsorCard, /<DoorOpen/);
  assert.match(sponsorCard, /<Share2/);
  assert.match(sponsorCard, /onDoubleClick=/);
  assert.doesNotMatch(sponsorCard, /bg-accent text-white hover:bg-accent\/90/);
  assert.doesNotMatch(sponsorCard, /Previous sponsor|Next sponsor/);
  assert.doesNotMatch(sponsorCard, /sponsor_logo_url|<Image/);
  assert.match(topCommentCard, /onDoubleClick=/);
  assert.ok(topCommentCard.includes('encodeURIComponent(comment.author_username)'));
  assert.doesNotMatch(topCommentCard, /Open discussion/);
  assert.doesNotMatch(topCommentCard, /<Button/);
  assert.match(topCommentCard, /Top Comments/);
  assert.match(topCommentCard, /rounded-full px-4 transition-colors/);
  assert.match(topCommentCard, /h-11 w-11 items-center justify-center rounded-full/);
  assert.match(topCommentCard, /topic_question/);
  assert.match(topCommentCard, /mt-6 flex items-center justify-center/);
  assert.ok(topCommentCard.includes('href={`/profile/${encodeURIComponent(comment.author_username)}`}'));
  assert.doesNotMatch(topCommentCard, /Pinned comment|Previous comment|Next comment/);
  assert.doesNotMatch(topCommentCard, /footer=\{/);
  assert.match(interstitialMotion, /absDx > width \* 0\.07 \|\| velocityX > 25/);
  assert.match(interstitialMotion, /absDy > height \* 0\.07 \|\| velocityY > 25/);
  assert.match(interstitialMotion, /case ' '/);
  assert.match(interstitialMotion, /setPointerCapture\(event\.pointerId\)/);
  assert.match(interstitialMotion, /flushSync\(\(\) =>/);
});


test('the original analytics-ranked feed keeps interstitials in per-topic session caches', () => {
  assert.match(feedCore, /const shuffled = personalized \? topics : shuffle\(topics\)/);
  assert.match(feedCore, /const result = await loadPage\(nextCursor\)/);
  assert.match(feedCore, /setTopicIndex\(\(prev\) => \(prev \+ 1\) % feedTopics\.length\)/);
  assert.match(feedCore, /topCommentCardsByTopicId = useRef\(new Map/);
  assert.match(feedCore, /sponsorCardsByTopicId = useRef\(new Map/);
  assert.match(feedCore, /topCommentCardsByTopicId\.current\.set\(currentTopic\.id/);
  assert.match(feedCore, /sponsorCardsByTopicId\.current\.set\(currentTopic\.id/);
  assert.match(feedCore, /sponsorCardsByTopicId\.current\.get\(previousTopicId\)/);
  assert.match(feedCore, /topCommentCardsByTopicId\.current\.get\(previousTopicId\)/);
  assert.match(feedCore, /TOP_COMMENT_CADENCE/);
  assert.match(feedCore, /SPONSOR_CARD_CADENCE/);
  assert.match(feedCore, /pendingSponsorAfterComment\.current = sponsorDue/);
  assert.match(feedCore, /sponsorRequestVersion\.current !== requestVersion/);
  assert.doesNotMatch(feedCore, /buildFeedQueue|feedQueueWindow|renderFeedQueueEntry/);
  assert.match(feedCore, /onPreviousTopic=\{\(\) => \{/);
  assert.match(feedCore, /The comment card follows the current topic/);
  assert.match(feedCore, /The sponsor is an interstitial after the current topic/);
  assert.match(feedCore, /Re-entering a topic replays the exact interstitials already assigned to it/);
  assert.match(feedCore, /if \\(preservePositionOnUpdate && feedInitializedRef\\.current\\)/);
  assert.match(feedCore, /previousPersonalizedRef\\.current !== personalized/);
});
