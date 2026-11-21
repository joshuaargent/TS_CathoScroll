import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [commentSource, sponsorSource, feedCore, topicFeed, cardRegistry, placementRegistry, topicCard, topCommentCard, sponsorCard, topicViewer, interstitialMotion, sponsorLoadingCard, baseFeedCard, feedRenderer, sharedSwipeGesture, sharedViewport] = await Promise.all([
  readFile(new URL('../src/lib/feed-comments.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-campaigns.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeed.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/feed-card-registry.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-card-placement-registry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicSwipeViewer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/FeedInterstitialMotion.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorLoadingCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/BaseFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/FeedRenderer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/useTopicSwipeGesture.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/FeedSwipeViewport.tsx', import.meta.url), 'utf8'),
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

test('sponsor placement cadence is independent of sign-in while comment inventory remains user-aware', () => {
  assert.equal(comments.shouldInsertTopCommentCard(4, false), false);
  assert.equal(sponsors.shouldInsertSponsorCard(9, false), true);
  assert.equal(comments.shouldInsertTopCommentCard(4, true), true);
  assert.equal(sponsors.shouldInsertSponsorCard(9, true), true);
});

test('the tenth-topic collision is planned as comment then sponsor before navigation', () => {
  assert.match(placementRegistry, /id: DEFAULT_FEED_CARD_RULES\.topComments\.id/);
  assert.match(placementRegistry, /id: DEFAULT_FEED_CARD_RULES\.sponsor\.id/);
  assert.match(placementRegistry, /priority: DEFAULT_FEED_CARD_RULES\.topComments\.priority/);
  assert.match(placementRegistry, /priority: DEFAULT_FEED_CARD_RULES\.sponsor\.priority/);
  assert.match(cardRegistry, /registerFeedEntry<Extract<FeedEntry, \{ type: 'top-comments' \}>/);
  assert.match(cardRegistry, /registerFeedEntry<Extract<FeedEntry, \{ type: 'sponsor' \}>/);
  assert.doesNotMatch(feedCore, /const chooseSponsor = sponsorDue && !commentDue/);
  assert.doesNotMatch(feedCore, /const commentDue = shouldInsertTopCommentCard/);
});

test('sponsor fetches cannot race feed navigation or account changes', () => {
  assert.match(feedCore, /sponsorRequestVersion/);
  assert.match(feedCore, /sponsorRequestVersion\.current !== requestVersion/);
  assert.match(feedCore, /const cancelSponsorRequest = \(\) =>/);
  assert.match(feedCore, /sponsorRequestVersion\.current \+= 1/);
  assert.match(cardRegistry, /onExit: \(entry, direction, cardContext\)/);
  assert.match(feedCore, /invokeRegisteredFeedEntryLifecycle/);
});


test('interstitial cards share the topic viewer swipe and animation model', () => {
  assert.match(sharedViewport, /duration: 0\.2,[\s\S]*ease: 'easeOut'/);
  assert.match(sharedSwipeGesture, /stiffness: 1800, damping: 120/);
  assert.match(sharedSwipeGesture, /window\.innerWidth \* 0\.07/);
  assert.match(sharedSwipeGesture, /window\.innerHeight \* 0\.07/);
  assert.match(sharedSwipeGesture, /velocityX > 25/);
  assert.match(sharedSwipeGesture, /velocityY > 25/);
  assert.match(interstitialMotion, /canSwipeLeft/);
  assert.match(interstitialMotion, /canSwipeRight/);
  assert.match(sharedSwipeGesture, /window.addEventListener\('keydown', handleKeyDown\)/);
  for (const source of [topCommentCard, sponsorCard]) {
    assert.match(source, /<FeedInterstitialMotion/);
    assert.match(source, /onNextTopic=\{navigateNextTopic\}/);
    assert.match(source, /onPreviousTopic=\{navigatePreviousTopic\}/);
    assert.match(source, /<BaseFeedCard/);
  }
  assert.match(topicViewer, /<FeedSwipeViewport/);
  assert.match(topicViewer, /if \(active\) onProgressChange\?\.\(slideIndex, slides\.length\)/);
  assert.match(topicViewer, /onTransitionStart=\{\(\) => setIsAnimating\(true\)\}/);
  assert.match(interstitialMotion, /<FeedSwipeViewport/);
});
test('topic, comment and sponsor cards use the same shared base card', () => {
  for (const source of [topicCard, topCommentCard, sponsorCard, sponsorLoadingCard]) {
    assert.match(source, /<BaseFeedCard/);
  }
  assert.match(baseFeedCard, /flex h-full w-full flex-col px-6 py-6 md:px-8 md:py-8/);
  assert.match(baseFeedCard, /cardClassName/);
  assert.match(baseFeedCard, /flex items-center justify-between/);
  assert.match(baseFeedCard, /flex flex-1 items-center justify-center/);
  assert.match(baseFeedCard, /flex flex-1 items-center justify-center/);
  assert.match(baseFeedCard, /mx-auto text-center/);
  assert.match(baseFeedCard, /flex items-center justify-between/);
  assert.match(topCommentCard, /onProgressChange\(safeIndex, comments\.length\)/);
  assert.doesNotMatch(topCommentCard, /<FeedProgress current=/);
  assert.doesNotMatch(sponsorCard, /<FeedProgress current=/);
  assert.doesNotMatch(sponsorLoadingCard, /<FeedProgress current=/);
  assert.ok(topicCard.includes("className={type === 'question' ? 'bg-accent-light/5' : undefined}"));
  assert.ok(topCommentCard.includes('className="bg-accent-light/5"'));
  assert.match(topCommentCard, /<Heart/);
  assert.match(topCommentCard, /<MessageCircle/);
  assert.match(topCommentCard, /<DoorOpen/);
  assert.match(sponsorCard, /<DoorOpen/);
  assert.match(sponsorCard, /<Share2/);
  assert.match(sponsorCard, /onDoubleClick=/);
  assert.doesNotMatch(sponsorCard, /bg-accent text-white hover:bg-accent\/90/);
  assert.doesNotMatch(sponsorCard, /Previous sponsor|Next sponsor/);
  assert.doesNotMatch(sponsorCard, /sponsor_logo_url|<Image/);
  assert.doesNotMatch(sponsorSource, /sponsor_logo_url|logo_url/);
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
  assert.match(sharedSwipeGesture, /absDx > window\.innerWidth \* 0\.07 \|\| velocityX > 25/);
  assert.match(sharedSwipeGesture, /absDy > window\.innerHeight \* 0\.07 \|\| velocityY > 25/);
  assert.match(sharedSwipeGesture, /case ' '/);
  assert.match(sharedSwipeGesture, /setPointerCapture\(event\.pointerId\)/);
  assert.match(sharedViewport, /flushSync\(\(\) =>/);
  assert.match(sharedViewport, /await navigation;/);
  assert.match(topicViewer, /awaitVerticalNavigation=\{false\}/);
  assert.match(topicViewer, /return direction === 'next' \? onNextTopic\?\.\(\) : onPreviousTopic\?\.\(\)/);
  assert.match(topCommentCard, /await onNextTopic\(\)/);
  assert.match(sponsorCard, /await onNextTopic\(\)/);
  assert.match(sponsorCard, /navigationStarted\.current = false/);
  assert.match(sponsorCard, /catch \(error\)/);
  assert.match(feedCore, /const nextTopic = \(\) => navigateFeedEntry\('next'\)/);
  assert.match(feedCore, /activeFeedEntryKey/);
  assert.match(cardRegistry, /<SponsorLoadingCard/);
  assert.match(cardRegistry, /invokeRegisteredFeedEntryAction\(entry, 'previous', registrations, context\)/);
  assert.match(feedCore, /const firstSponsor = boundaries/);
  assert.match(feedCore, /prefetchMappedSponsor\(firstSponsor\.topicId\)/);
  assert.match(feedCore, /const nextSponsorBoundary = boundaries/);
  assert.match(feedCore, /const activateFeedEntry = async/);
  assert.match(cardRegistry, /onEnter: \(entry/);
  assert.match(cardRegistry, /for \(const comment of entry\.comments\)/);
  assert.match(cardRegistry, /cacheCommentGroup\(entry\.topicId, entry\.comments\)/);
  assert.match(cardRegistry, /onEnter: \(entry/);
  assert.match(cardRegistry, /void cardContext\.loadSponsorEntry\(entry, direction, entries\)/);
  assert.match(feedCore, /sponsorResultsByTopicId = useRef\(new Map/);
  assert.match(feedCore, /sponsorRequestsByTopicId = useRef\(new Map/);
  assert.match(cardRegistry, /userId=\{context\.userId\}/);
  assert.match(sponsorLoadingCard, /role="status" aria-live="polite" aria-busy=\{!error\}/);
  assert.match(sponsorLoadingCard, /onClick=\{onRetry\}/);
  assert.match(sponsorLoadingCard, /Sponsored content is temporarily unavailable/);
  assert.match(sponsorLoadingCard, /<FeedInterstitialMotion/);
  assert.match(feedCore, /window\.setTimeout\(\(\) => controller\.abort\(\), 8000\)/);
  assert.match(feedCore, /const navigateFeedEntry = async/);
  assert.match(feedCore, /getAdjacentFeedEntry\(entries, currentKey, direction\)/);
  assert.doesNotMatch(sponsorLoadingCard, /cardClassName/);
});


test('the original analytics-ranked topic feed is retained and interstitials are precomputed in one boundary map', () => {
  assert.match(feedCore, /const orderedTopics = personalized \|\| generalRanked \? topics : shuffle\(topics\)/);
  assert.match(feedCore, /const result = await loadPage\(nextCursor\)/);
  assert.match(feedCore, /setTopicIndex\(\(prev\) => \(prev \+ 1\) % feedTopics\.length\)/);
  assert.match(feedCore, /feedEntryMapRef = useRef/);
  assert.match(feedCore, /buildFeedEntryMap\(/);
  assert.match(feedCore, /const boundary = feedEntryMapRef\.current\?\.byTopicId\.get\(currentTopic\.id\)/);
  assert.match(feedCore, /const adjacent = getAdjacentFeedEntry\(entries, currentKey, direction\)/);
  assert.match(feedCore, /await activateFeedEntry\(adjacent\.entry, direction, entries\)/);
  assert.match(feedCore, /commentCadenceAfter/);
  assert.match(feedCore, /sponsorCadenceAfter/);
  assert.match(feedCore, /processedTopicBoundariesByTopicId\.current\.has\(currentTopic\.id\)/);
  assert.match(feedCore, /boundary.entries = boundary.entries.filter/);
  assert.match(feedCore, /const commentsById = new Map/);
  assert.match(feedCore, /getSponsorCampaignResult\(topic\)/);
  assert.doesNotMatch(feedCore, /shouldInsertTopCommentCard|shouldInsertSponsorCard|getNextTopCommentCadence|getNextSponsorCadence/);
  assert.doesNotMatch(feedCore, /const commentDue =|const sponsorDue =/);
  assert.match(feedCore, /topCommentCardsByTopicId = useRef\(new Map/);
  assert.match(feedCore, /sponsorCardsByTopicId = useRef\(new Map/);
  assert.match(feedCore, /processedTopicBoundariesByTopicId = useRef\(new Set<string>\(\)\)/);
  assert.match(feedCore, /if \(preservePositionOnUpdate && feedInitializedRef\.current\)/);
  assert.match(topicFeed, /preservePositionOnUpdate/);
  assert.match(feedCore, /function appendUniqueFeedTopics\(existing: Topic\[\], incoming: Topic\[\]\)/);
  assert.match(feedCore, /const loadMoreTopComments = useCallback\(async \(\) =>/);
  assert.match(feedCore, /offset=.*limit=100/);
  assert.match(feedCore, /topCommentsNextOffsetRef\.current = nextOffset/);
  assert.match(feedCore, /const nextTopics = appendUniqueFeedTopics\(feedTopicsRef\.current, newTopics\)/);
  assert.match(feedCore, /pendingAdvanceAfterPageRef\.current = true/);
  assert.match(feedCore, /activeInterstitialTopicIdRef = useRef<string \| null>\(null\)/);
  assert.match(cardRegistry, /initialActiveIndex=\{context\.activeTopCommentIndex\}/);
  assert.match(topCommentCard, /initialActiveIndex\?: number/);
  assert.match(topCommentCard, /onActiveIndexChange\?\.\(nextIndex\)/);
  assert.match(feedCore, /sponsorRequestVersion\.current !== requestVersion/);
});

test('topics, comments and sponsors occupy one exclusive feed-card slot', () => {
  assert.match(feedRenderer, /className="relative min-h-0 flex-1"/);
  assert.match(feedRenderer, /entryCard: ReactNode/);
  assert.match(feedRenderer, /\{entryCard\}/);
  assert.doesNotMatch(feedRenderer, /absolute inset-0 z-10|invisible pointer-events-none|topicViewer|activeEntry/);
  assert.match(feedRenderer, /No inactive card is mounted beneath it/);
  assert.match(feedCore, /<FeedRenderer/);
  assert.match(feedCore, /const topicCard = \(/);
  assert.match(feedCore, /const renderedActiveEntry = activeMappedEntry/);
  assert.match(feedCore, /entryCard=\{renderedActiveEntry\}/);
  assert.match(cardRegistry, /registerFeedEntry<Extract<FeedEntry, \{ type: 'topic' \}>/);
  assert.match(feedCore, /active=\{!activeFeedCardEntry\}/);
  assert.doesNotMatch(feedCore, /renderedFeedCard \?\? \(/);
});

test('all card types preview their actual adjacent mapped feed entry without preview side effects', () => {
  assert.doesNotMatch(topicViewer, /showEntryPreviews|setShowEntryPreviews/);
  assert.match(topicViewer, /previousEntryPreview !== null/);
  assert.match(topicViewer, /nextEntryPreview !== null/);
  assert.match(topicViewer, /nextEntryPreview === undefined/);
  assert.match(feedCore, /const currentEntryKey = activeMappedEntry/);
  assert.match(feedCore, /const renderFeedEntryPreview = \(entry: FeedEntry \| null\)/);
  assert.match(feedCore, /const nextEntryPreview = renderFeedEntryPreview\(nextFeedEntry\)/);
  assert.match(feedCore, /const previousEntryPreview = renderFeedEntryPreview\(previousFeedEntry\)/);
  assert.match(feedCore, /previewMode: true/);
  assert.match(cardRegistry, /previewMode=\{context\.previewMode\}/);
  assert.match(cardRegistry, /nextEntryPreview=\{context\.nextEntryPreview\}/);
  assert.match(cardRegistry, /previousEntryPreview=\{context\.previousEntryPreview\}/);
  assert.match(topCommentCard, /if \(active && !previewMode && activeCommentId !== undefined\) onCommentViewed\(activeCommentId\)/);
  assert.match(topCommentCard, /if \(active && !previewMode\) onProgressChange\(safeIndex, comments\.length\)/);
});


test('transient sponsor request failures remain retryable and cannot overwrite a newer request', () => {
  assert.match(feedCore, /retryable: true/);
  assert.match(feedCore, /sponsorSessionUserId\.current === requestedUserId && !result\.retryable/);
  assert.match(feedCore, /sponsorRequestsByTopicId\.current\.get\(topic\.id\) === request/);
  assert.match(feedCore, /if \(result\.retryable\) \{[\s\S]*?entry\.status = 'error';[\s\S]*?return;[\s\S]*?\}\s*\n\s*entry\.status = 'empty';[\s\S]*?sponsorDueByTopicId\.current\.delete\(entry\.topicId\)/);
});


test('sponsor viewability attribution survives card unmounts and remounts', () => {
  assert.match(sponsorCard, /const viewableSponsorPlacements = new Set<string>\(\)/);
  assert.match(sponsorCard, /getSponsorPlacementKey\(userId, sessionId, campaignId, placementKey, placementReceipt\)/);
  assert.match(sponsorCard, /viewableSponsorPlacements\.has\(viewablePlacementKey\)/);
  assert.match(sponsorCard, /rememberViewableSponsorPlacement\(viewablePlacementKey\)/);
  assert.match(sponsorCard, /viewableSponsorPlacements\.size > 5000/);
});
