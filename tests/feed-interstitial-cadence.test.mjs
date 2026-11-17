import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [commentSource, sponsorSource, feedCore, topicCard, topCommentCard, sponsorCard, topicViewer, interstitialMotion, topicCardLayout, topCommentsRoute, feedQueueSource] = await Promise.all([
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
  readFile(new URL('../src/lib/feed-queue.ts', import.meta.url), 'utf8'),
]);

async function importTypeScript(source) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const comments = await importTypeScript(commentSource);
const sponsors = await importTypeScript(sponsorSource);
const feedQueue = await importTypeScript(feedQueueSource);

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
  assert.match(topicCardLayout, /progress && <div className="shrink-0 pb-5">/);
  assert.match(topCommentCard, /<TopicProgress current=\{safeIndex\} total=\{comments\.length\} \/>/);
  assert.ok(topicCard.includes('bg-accent-light/5'));
  assert.ok(topCommentCard.includes('bg-accent-light/5'));
  assert.match(topCommentCard, /<Heart/);
  assert.match(topCommentCard, /<MessageCircle/);
  assert.match(topCommentCard, /<DoorOpen/);
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


test('top-comment inventory pages beyond five and reserves groups of at most five', () => {
  const makeComment = (id) => ({
    comment_id: id, topic_slug: 'topic', topic_question: 'Question?', category_name: 'Category',
    author_display_name: 'Member', author_username: null, content: 'Comment',
    content_truncated: false, created_at: '2026-11-01T00:00:00.000Z', is_pinned: false,
    like_count: 2, reply_count: 1,
  });
  const parsed = comments.parseTopFeedComments({ comments: Array.from({ length: 120 }, (_, index) => makeComment(index + 1)) });
  assert.equal(parsed.length, 100);
  assert.equal(comments.getUnseenTopFeedComments(parsed, new Set([1, 2])).length, 98);
  assert.match(topCommentsRoute, /p_offset: offset/);
  assert.match(topCommentsRoute, /p_limit: limit/);
  assert.match(topCommentsRoute, /data\.comments\.length > limit/);
  assert.match(feedCore, /unseenTopComments\.slice\(0, 5\)/);
  assert.match(feedCore, /nextTopCommentGroup\.forEach\(\(comment\) => seenTopCommentIds\.current\.add\(comment\.comment_id\)\)/);
  assert.match(feedCore, /topCommentsNextOffset/);
  assert.match(feedCore, /topCommentInventoryVersion/);
});


test('the ordered feed queue keeps topic, comments and sponsor entries in cadence order', () => {
  const comment = {
    comment_id: 1, topic_slug: 'topic-a', topic_question: 'Question?', category_name: 'Category',
    author_display_name: 'Member', author_username: null, content: 'Comment',
    content_truncated: false, created_at: '2026-11-01T00:00:00.000Z', is_pinned: false,
    like_count: 2, reply_count: 1,
  };
  const campaign = {
    campaign_id: '123e4567-e89b-12d3-a456-426614174000', sponsor_name: 'Sponsor', sponsor_logo_url: null,
    campaign_name: 'Campaign', headline: 'Headline', body: 'Body', image_url: null,
    destination_url: 'https://example.com', cta_label: 'Learn more', disclosure: 'Sponsored',
  };
  const queue = feedQueue.buildFeedQueue(
    [{ id: 'topic-a' }, { id: 'topic-b' }],
    new Map([['topic-a', [comment]]]),
    new Map([['topic-a', { campaigns: [campaign], sessionId: 'session-a' }]])
  );
  assert.deepEqual(queue.map((entry) => entry.type), ['topic', 'top-comments', 'sponsor', 'topic']);
  const window = feedQueue.getFeedQueueWindow(queue, 1);
  assert.equal(window.previous?.type, 'topic');
  assert.equal(window.current?.type, 'top-comments');
  assert.equal(window.next?.type, 'sponsor');
  assert.match(feedCore, /buildFeedQueue/);
  assert.match(feedCore, /getFeedQueueWindow/);
  assert.match(feedCore, /activeFeedQueueEntry\\?\.type === 'sponsor'/);
});
