import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [cache, native, audit, privacy] = await Promise.all([
  readFile(new URL('../src/lib/offline/ranked-feed-cache.ts', import.meta.url), 'utf8'),
  readFile(new URL('../native/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/native-offline-capability-audit.md', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/privacy/page.tsx', import.meta.url), 'utf8'),
]);

test('fresh native Account loads can read encrypted personalisation consent and withdraw offline', async () => {
  const account = await readFile(new URL('../src/components/account/PersonalizationAccountSection.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/account/AnalyticsConsentSettingsPanel.tsx', import.meta.url), 'utf8');
  assert.match(cache, /async getCachedConsent\(userId: string\)/);
  assert.match(cache, /pending_sync FROM offline_personalization_consent_cache/);
  assert.match(native, /personalization-consent-status-request/);
  assert.match(account, /client\.auth\.getSession\(\)/);
  assert.match(account, /readNativePersonalizationCache\(sessionUser\.id\)/);
  assert.match(account, /forcedOfflineWithdrawal/);
  assert.match(account, /syncNativeConsent\(accountUserId, false, true\)/);
  assert.match(account, /personalizationStatusKnown/);
  assert.doesNotMatch(panel, /personalizationStatusKnown/);
  assert.match(panel, /previous\?\.serviceImprovement === true/);
});

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
  const consentDenialWrite = cache.indexOf('VALUES (?, 0, ?, ?)');
  const personalisedPageDelete = cache.indexOf("DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ?", consentDenialWrite);
  assert.ok(consentDenialWrite >= 0 && personalisedPageDelete > consentDenialWrite);
  assert.match(native, /personalizedFeedCacheRef\.current\.hasFreshConsent\(user\.id\)/);
  assert.match(native, /personalizedFeedCacheRef\.current\?\.setConsent\(user\.id, status\.enabled\)/);
  assert.match(native, /personalizedFeedCacheRef\.current\.save\('personalized', user\.id, null, page\)/);
  assert.match(privacy, /12 hours after the last successful consent check/);
  assert.match(privacy, /cleared when[\s\S]*?personalisation is withdrawn or the account changes/);
});

test('withdrawing Service improvement clears cached passive-signal recommendations without disabling Personalisation', () => {
  const start = cache.indexOf('async clearPersonalizedPages(userId: string)');
  const end = cache.indexOf('async clearUser(userId: string)', start);
  assert.ok(start >= 0 && end > start);
  const clearPages = cache.slice(start, end);
  assert.match(clearPages, /DELETE FROM offline_ranked_feed_pages/);
  assert.doesNotMatch(clearPages, /offline_personalization_consent_cache/);
  assert.match(native, /analyticsConsentChangeEvent/);
  assert.match(native, /detail\.choice === 'serviceImprovement'/);
  assert.match(native, /detail\.consent\?\.serviceImprovement === false/);
  assert.match(native, /detail\.consent\?\.serviceImprovement === true && detail\.consent\.syncPending === false/);
  assert.match(native, /cache\.clearPersonalizedPages\(user\.id\)/);
  assert.match(native, /pendingServiceImprovementCacheRefreshUserIdRef/);
  assert.match(native, /readAnalyticsConsent\(user\.id\)/);
  assert.match(native, /serviceImprovementWithdrawalPending/);
  assert.match(native, /!serviceImprovementWithdrawalPending && user\?\.id && personalizedFeedCacheRef/);
  assert.match(native, /await personalizedFeedCacheRef\.current\.clearPersonalizedPages\(user\.id\)/);
  assert.match(native, /offline reading falls back to the general feed/);
});

test('personalised page cache is initialised only after the encrypted private database opens', () => {
  const openPrivate = native.indexOf('cacheDatabase = await openPrivateActivityDatabase(secureAuthStorage)');
  const personalizedInit = native.indexOf('new OfflineRankedFeedCache(cacheDatabase, localCatalogue, true)');
  assert.ok(openPrivate >= 0 && personalizedInit > openPrivate);
  assert.match(native, /new OfflineRankedFeedCache\(databases\.catalogue, localCatalogue\)/);
  assert.match(native, /new OfflineRankedFeedCache\(cacheDatabase, localCatalogue, true\)/);
  assert.match(native, /if \(privateDatabaseReady\)[\s\S]*?new OfflineRankedFeedCache\(cacheDatabase, localCatalogue, true\)/);
});


test('offline personalisation withdrawal persists a deny tombstone until server sync succeeds', () => {
  assert.match(cache, /pending_sync INTEGER NOT NULL DEFAULT 0/);
  assert.match(cache, /async getPendingConsent/);
  assert.match(cache, /async setConsent\(userId: string, enabled: boolean, pendingSync = false\)/);
  assert.match(cache, /VALUES \(\?, 0, \?, \?\)/);
  assert.match(native, /getPendingConsent\(user\.id\)/);
  assert.match(native, /pendingConsent !== false/);
  assert.match(native, /set_my_personalization_consent', \{ p_enabled: false \}/);
  assert.match(native, /cathoscroll:personalization-consent-changed/);
});


test('pending offline withdrawal tombstones survive cache expiry and account cache cleanup', () => {
  assert.match(cache, /checked_at < \? AND pending_sync = 0/);
  assert.match(cache, /DELETE FROM offline_personalization_consent_cache WHERE user_id = \? AND pending_sync = 0/);
});


test('native feed retries queued consent withdrawal automatically on reconnect', () => {
  assert.match(native, /addEventListener\('online', retryPendingConsentSync\)/);
  assert.match(native, /removeEventListener\('online', retryPendingConsentSync\)/);
});


test('withdrawal writes local denial using cached identity before network-dependent getUser', async () => {
  const account = await readFile(new URL('../src/components/account/PersonalizationAccountSection.tsx', import.meta.url), 'utf8');
  const update = account.slice(account.indexOf('async function updateConsent'), account.indexOf('function refreshStatus'));
  assert.ok(update.indexOf('syncNativeConsent(accountUserId, false, true)') < update.indexOf('client.auth.getUser()'));
});

test('local withdrawal replaces the active personalised feed and retries the server state', () => {
  assert.match(native, /setFirstPage\(null\)/);
  assert.match(native, /setFeedAttempt\(\(attempt\) => attempt \+ 1\)/);
});


test('withdrawal clears the stale personalised page before the replacement feed is published', () => {
  assert.match(native, /setFirstPage\(null\)/);
  assert.doesNotMatch(native, /setFeedPersonalized\(detail\.enabled\)/);
});

test('all pre-release native personalisation choices and pages are invalidated', () => {
  assert.match(cache, /personalizationConsentVersion = '2026-11-21-v6'/);
  assert.match(cache, /personalization_consent_version/);
  assert.match(cache, /DELETE FROM offline_personalization_consent_cache/);
  assert.doesNotMatch(cache, /WHERE enabled = 1 OR pending_sync = 0/);
  assert.match(cache, /DELETE FROM offline_ranked_feed_pages WHERE mode = \?/);
  const tableCreate = cache.indexOf('CREATE TABLE IF NOT EXISTS offline_personalization_consent_cache');
  const versionCheck = cache.indexOf('SELECT cache_value FROM offline_ranked_feed_cache_meta WHERE cache_key = ?', tableCreate);
  const staleGrantDelete = cache.indexOf('DELETE FROM offline_personalization_consent_cache', versionCheck);
  assert.ok(tableCreate >= 0 && versionCheck > tableCreate && staleGrantDelete > versionCheck);
});

test('personalised offline pages are invalidated when the recommendation model changes', () => {
  assert.match(cache, /offline_ranked_feed_cache_meta/);
  assert.match(cache, /personalized_model_version/);
  assert.match(cache, /activity-signals-v4/);
  const modelCheck = cache.indexOf('SELECT cache_value FROM offline_ranked_feed_cache_meta');
  const pageInvalidation = cache.indexOf('DELETE FROM offline_ranked_feed_pages WHERE mode = ?', modelCheck);
  const modelWrite = cache.indexOf('INSERT OR REPLACE INTO offline_ranked_feed_cache_meta', pageInvalidation);
  assert.ok(modelCheck >= 0 && pageInvalidation > modelCheck && modelWrite > pageInvalidation);
});


test('offline cached consent never allows empty category interests to be saved', async () => {
  const account = await readFile(new URL('../src/components/account/PersonalizationAccountSection.tsx', import.meta.url), 'utf8');
  assert.match(account, /setCategoryInterestsLoaded\(false\)/);
  assert.match(account, /!categoryInterestsLoaded \|\| selectedCategories\.length > 20/);
  assert.match(account, /disabled=\{!status\.enabled \|\| !categoryInterestsLoaded/);
  assert.match(account, /Saved category interests are not available offline/);
  assert.match(account, /Topic-interest details are unavailable offline/);
  assert.match(account, /loading \|\| !categoryInterestsLoaded \? '—' : status\.category_interests/);
});
