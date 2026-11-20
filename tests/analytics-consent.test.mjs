import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('optional analytics consent is explicit, versioned and off by default', async () => {
  const [consent, manager, layout, native] = await Promise.all([
    read('../src/lib/analytics-consent.ts'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/layout.tsx'),
    read('../native/main.tsx'),
  ]);
  assert.ok(consent.includes('serviceImprovement: false'));
  assert.ok(consent.includes('sponsorMeasurement: false'));
  assert.ok(consent.includes('analyticsConsentVersion = 1'));
  assert.ok(manager.includes('Accept all'));
  assert.ok(manager.includes('Decline optional'));
  assert.ok(manager.includes('Manage choices'));
  assert.ok(manager.includes('Service improvement analytics'));
  assert.ok(manager.includes('Sponsor measurement'));
  assert.ok(layout.includes('<WebAnalyticsConsentManager />'));
  assert.ok(native.includes('<AnalyticsConsentManager'));
});

test('signed-in consent is synchronized and enforced by authenticated ingestion APIs', async () => {
  const [manager, route, serverConsent, topicRoute, commentRoute, sponsorRoute, sql] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/api/privacy/analytics-consent/route.ts'),
    read('../src/lib/analytics-consent-server.ts'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  assert.ok(manager.includes('analytics-consent'));
  assert.ok(manager.includes("window.addEventListener('online', syncServerConsent)"));
  assert.ok(route.includes('set_user_analytics_consent'));
  assert.ok(serverConsent.includes('get_user_analytics_consent'));
  assert.ok(topicRoute.includes("getStoredAnalyticsConsent(user.id)"));
  assert.ok(commentRoute.includes("getStoredAnalyticsConsent(user.id)"));
  assert.ok(sponsorRoute.includes('getStoredAnalyticsConsent(auth.user.id)'));
  assert.ok(sql.includes('user_analytics_consents'));
  assert.ok(sql.includes('user_analytics_consent_history'));
  assert.ok(sql.includes("consent.service_improvement = true"));
  assert.ok(sql.includes("consent.sponsor_measurement = true"));
  assert.ok(sql.includes('FOR SHARE'));
});

test('withdrawing consent clears the matching durable native analytics streams', async () => {
  const [manager, store, feed, comments, sponsor] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/lib/offline/signed-in-analytics-store.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
    read('../src/lib/sponsor-analytics-client.ts'),
  ]);
  assert.ok(store.includes('clearStream(userId: string, stream: SignedInAnalyticsStream)'));
  assert.ok(manager.includes('clearFeedAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearFeedCardAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearSponsorAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('const interim ='));
  assert.ok(manager.includes('saveAnalyticsConsent(interim, userId)'));
  assert.ok(feed.includes('createConsentBoundAbortSignal'));
  assert.ok(comments.includes('createConsentBoundAbortSignal'));
  assert.ok(sponsor.includes('createConsentBoundAbortSignal'));
  assert.ok(feed.includes("clearStream(userId, 'topic')"));
  assert.ok(comments.includes("clearStream(userId, 'comment')"));
  assert.ok(sponsor.includes("clearStream(userId, 'sponsor')"));
  assert.ok(feed.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', null)"));
});

test('declining sponsor measurement preserves sponsor delivery without session frequency tracking', async () => {
  const [feed, selectRoute, bootstrap, migration] = await Promise.all([
    read('../src/components/topic/TopicFeedCore.tsx'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  assert.ok(feed.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes('const sessionId = measurementEnabled'));
  assert.ok(selectRoute.includes('const measurementSessionId: string | null'));
  assert.ok(selectRoute.includes('p_session_token: measurementSessionId'));
  assert.ok(selectRoute.includes('p_session_id: measurementSessionId'));
  for (const sql of [bootstrap, migration]) {
    assert.ok(sql.includes('p_session_token IS NOT NULL AND'));
    assert.ok(sql.includes('IF p_session_token IS NOT NULL THEN'));
    assert.ok(sql.includes('v_session_id := CASE WHEN coalesce(v_sponsor_measurement, false) THEN p_session_id ELSE NULL END'));
    assert.ok(sql.includes('IF v_session_id IS NOT NULL THEN'));
    assert.ok(sql.includes('INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,served_count)'));
    assert.ok(sql.includes('INSERT INTO catho_private.sponsor_campaign_daily'));
  }
});

test('recommendation personalisation remains separate from analytics consent', async () => {
  const [manager, signup, account] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/components/account/SignupForm.tsx').catch(() => ''),
    read('../src/components/account/PersonalizationAccountSection.tsx'),
  ]);
  assert.ok(manager.includes('Recommendation personalisation remains controlled separately'));
  assert.ok(account.includes('personalization'));
  assert.ok(!manager.includes('set_my_personalization_consent'));
  if (signup) assert.ok(signup.includes('personal'));
});
