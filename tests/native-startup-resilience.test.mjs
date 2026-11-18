import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [nativeMain, nativeNotes, feedCore] = await Promise.all([
  readFile(new URL('../native/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../native/notes.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
]);

test('native renderer failures show a recoverable error boundary instead of a blank screen', () => {
  assert.ok(nativeMain.includes('class NativeErrorBoundary extends Component'));
  assert.ok(nativeMain.includes('componentDidCatch(error: Error, info: ErrorInfo)'));
  assert.ok(nativeMain.includes('CathoScroll encountered an error'));
  assert.ok(nativeMain.includes('Restart app'));
});

test('native startup and feed failures render visible retry states', () => {
  assert.ok(nativeMain.includes('CathoScroll could not finish starting'));
  assert.ok(nativeMain.includes('Retry startup'));
  assert.ok(nativeMain.includes('Your feed is unavailable'));
  assert.ok(nativeMain.includes('Retry feed'));
});

test('native feed uses the authenticated Supabase session for sponsor delivery and analytics', () => {
  assert.ok(nativeMain.includes('getNativeSponsorAccessToken'));
  assert.ok(nativeMain.includes('getSponsorAccessToken={getNativeSponsorAccessToken}'));
});

test('optional offline caches cannot prevent the live native feed from opening', () => {
  assert.ok(nativeMain.includes('let commentsReady = false;'));
  assert.ok(nativeMain.includes('let countsReady = false;'));
  assert.ok(nativeMain.includes('let notesReady = false;'));
  assert.ok(nativeMain.includes('setCountCache(countsReady ? localCounts : null)'));
  assert.ok(nativeMain.includes('if (!navigation) throw new Error'));
  assert.ok(nativeMain.includes('if (countCache) {'));
});

test('native topic pages remain readable when optional comment or note caches fail', () => {
  assert.ok(nativeMain.includes("{catalogue && route?.kind === 'topic' && ("));
  assert.ok(nativeMain.includes('cache: OfflineCommentCache | null;'));
  assert.ok(nativeMain.includes('noteCache: NativeNoteCache | null;'));
  assert.ok(nativeMain.includes('cache={cache ?? undefined}'));
  assert.ok(nativeMain.includes('cache={noteCache}'));
  assert.ok(nativeNotes.includes('cache: NativeNoteCache | null;'));
});

test('native feed shows a retry state when both live and saved feed loading fail', () => {
  assert.ok(nativeMain.includes("setFeedLoadError('The topic feed could not be loaded. Check your connection or retry.')"));
});


test('native feed navigation is injected and does not require the Next.js App Router', () => {
  assert.ok(!feedCore.includes("from 'next/navigation'"));
  assert.ok(!feedCore.includes('useRouter('));
  assert.ok(feedCore.includes('onOpenComment: (comment: TopFeedComment) => void;'));
  assert.ok(feedCore.includes('    onOpenComment(comment);'));
  assert.ok(nativeMain.includes('onOpenComment={(comment: TopFeedComment) =>'));
});


test('native background catalogue sync does not replace the active feed snapshot', () => {
  const refreshStart = nativeMain.indexOf('const service = catalogueRefresh;');
  const refreshEnd = nativeMain.indexOf('}, [catalogueRefresh, catalogue]);', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  const refreshEffect = nativeMain.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(refreshEffect, /setFirstPage/);
  assert.match(refreshEffect, /setCatalogueVersion/);
});

test('native network changes do not reload the first feed page and account changes get a fresh feed', () => {
  const loadFeedStart = nativeMain.indexOf('async function loadFeed()');
  const loadFeedEnd = nativeMain.indexOf('useEffect(() => {', loadFeedStart);
  assert.ok(loadFeedStart >= 0 && loadFeedEnd > loadFeedStart);
  const loadFeedEffect = nativeMain.slice(loadFeedStart, loadFeedEnd);
  assert.doesNotMatch(loadFeedEffect, /window\.addEventListener\('online', reconnect\)/);
  assert.doesNotMatch(loadFeedEffect, /window\.addEventListener\('offline', reconnect\)/);
  assert.match(nativeMain, /key=\{user\?\.id \?\? 'signed-out'\}/);
  assert.match(nativeMain, /if \(feedUserIdRef\.current !== nextFeedUserId\)[\s\S]*?setFirstPage\(null\)/);
  assert.match(nativeMain, /feedSnapshotUserId === \(user\?\.id \?\? null\)/);
  assert.equal(nativeMain.split('preservePositionOnUpdate').length - 1, 1);
  assert.match(nativeMain, /\[catalogue\]/);
  assert.match(feedCore, /feedInitializedRef/);
  assert.match(feedCore, /function appendUniqueFeedTopics\(existing: Topic\[\], incoming: Topic\[\]\)/);
  assert.match(feedCore, /appendUniqueFeedTopics\(feedTopicsRef\.current, shuffled\)/);
  assert.match(feedCore, /if \(sourceChanged\)/);
});
