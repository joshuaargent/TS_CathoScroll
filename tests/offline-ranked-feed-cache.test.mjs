import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [cache, native, audit, privacy] = await Promise.all([
  readFile(new URL('../src/lib/offline/ranked-feed-cache.ts', import.meta.url), 'utf8'),
  readFile(new URL('../native/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/native-offline-capability-audit.md', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/privacy/page.tsx', import.meta.url), 'utf8'),
]);

test('offline general feed reuses the latest cached server-ranked pages', () => {
  assert.match(cache, /offline_ranked_feed_pages/);
  assert.match(cache, /mode TEXT NOT NULL CHECK \(mode IN \('general', 'personalized'\)\)/);
  assert.match(cache, /topicsByIds\(ids\)/);
  assert.match(native, /generalFeedCacheRef\.current\?\.load\('general', null, null\)/);
  assert.match(native, /generalFeedCacheRef\.current\?\.save\('general', null, null, page\)/);
  assert.match(native, /generalFeedCacheRef\.current\?\.load\('general', null, cursor\)/);
  assert.match(audit, /latest downloaded server-ranked pages cached/);
});

test('offline personalisation only reuses encrypted cached server pages with fresh consent', () => {
  assert.match(cache, /offline_personalization_consent_cache/);
  assert.match(cache, /consentFreshnessMs = 12 \* 60 \* 60 \* 1000/);
  assert.match(cache, /async hasFreshConsent/);
  assert.match(cache, /async clearUser/);
  assert.match(native, /personalizedFeedCacheRef\.current\.hasFreshConsent\(user\.id\)/);
  assert.match(native, /personalizedFeedCacheRef\.current\?\.setConsent\(user\.id, status\.enabled\)/);
  assert.match(native, /personalizedFeedCacheRef\.current\.save\('personalized', user\.id, null, page\)/);
  assert.match(privacy, /12 hours after the last successful consent check/);
  assert.match(privacy, /cleared when[\s\S]*?personalisation is withdrawn or the account changes/);
});

test('personalised page cache is initialised only after the encrypted private database opens', () => {
  const openPrivate = native.indexOf('cacheDatabase = await openPrivateActivityDatabase(secureAuthStorage)');
  const personalizedInit = native.indexOf('new OfflineRankedFeedCache(cacheDatabase, localCatalogue)');
  assert.ok(openPrivate >= 0 && personalizedInit > openPrivate);
  assert.match(native, /new OfflineRankedFeedCache\(databases\.catalogue, localCatalogue\)/);
  assert.match(native, /new OfflineRankedFeedCache\(cacheDatabase, localCatalogue, true\)/);
  assert.match(native, /if \(privateDatabaseReady\)[\s\S]*?new OfflineRankedFeedCache\(cacheDatabase, localCatalogue\)/);
});
