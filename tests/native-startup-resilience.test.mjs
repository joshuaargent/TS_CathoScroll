import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nativeMain = await readFile(new URL('../native/main.tsx', import.meta.url), 'utf8');

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
