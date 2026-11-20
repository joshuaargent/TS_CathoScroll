import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('optional analytics consent is explicit, purpose-specific and off by default', async () => {
  const [consent, manager, layout, native, cookies] = await Promise.all([
    read('../src/lib/analytics-consent.ts'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/layout.tsx'),
    read('../native/main.tsx'),
    read('../src/app/cookies/page.tsx'),
  ]);

  assert.ok(consent.includes('serviceImprovement: false'));
  assert.ok(consent.includes('sponsorMeasurement: false'));
  assert.ok(consent.includes('analyticsConsentVersion = 1'));
  assert.ok(consent.includes('syncPending: options.syncPending ?? Boolean(userId)'));
  assert.ok(consent.includes('deniedOverrides'));
  assert.ok(manager.includes('Accept all'));
  assert.ok(manager.includes('Decline optional'));
  assert.ok(manager.includes('Manage choices'));
  assert.ok(manager.includes('I explicitly agree to Service improvement analytics'));
  assert.ok(manager.includes('I explicitly agree to Sponsor measurement'));
  assert.ok(manager.includes('Recommendation personalisation remains controlled separately'));
  assert.ok(layout.includes('<WebAnalyticsConsentManager />'));
  assert.ok(native.includes('<AnalyticsConsentManager'));
  assert.ok(cookies.includes('AnalyticsConsentSettingsButton'));
});

test('account consent sync is identity-bound, retryable and enforced server-side', async () => {
  const [manager, route, serverConsent, topicRoute, commentRoute, sponsorRoute, migration] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/api/privacy/analytics-consent/route.ts'),
    read('../src/lib/analytics-consent-server.ts'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../supabase/migrations/20261120180000_analytics_consent_and_sponsor_opt_out.sql'),
  ]);

  assert.ok(manager.includes("window.addEventListener('online', syncServerConsent)"));
  assert.ok(manager.includes('local.syncPending || !remote.exists'));
  assert.ok(manager.includes('getAccessToken(expectedUserId)'));
  assert.ok(manager.includes('activeUserIdRef.current === expectedUserId'));
  assert.ok(manager.includes('syncAbortRef.current?.abort()'));
  assert.ok(route.includes("request.headers.get('X-Catho-Expected-User-Id')"));
  assert.ok(route.includes('Account changed during consent synchronisation.'));
  assert.ok(route.includes('X-Catho-Expected-User-Id'));
  assert.ok(route.includes('set_user_analytics_consent'));
  assert.ok(serverConsent.includes('get_user_analytics_consent'));
  assert.ok(topicRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(commentRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(sponsorRoute.includes('getStoredAnalyticsConsent(auth.user.id)'));
  assert.ok(migration.includes('user_analytics_consents'));
  assert.ok(migration.includes('user_analytics_consent_history'));
  assert.ok(migration.includes('SELECT consent.service_improvement INTO v_service_consent'));
  assert.ok(migration.includes('SELECT consent.sponsor_measurement INTO v_sponsor_consent'));
});

test('withdrawal immediately blocks and clears the matching web and native analytics queues', async () => {
  const [manager, consent, store, feed, comments, anonymous, sponsor] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/lib/analytics-consent.ts'),
    read('../src/lib/offline/signed-in-analytics-store.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
    read('../src/lib/anonymous-feed-analytics-client.ts'),
    read('../src/lib/sponsor-analytics-client.ts'),
  ]);

  assert.ok(consent.includes('denyAnalyticsConsentInMemory'));
  assert.ok(consent.includes('deniedOverrides.add'));
  assert.ok(consent.includes('new BroadcastChannel'));
  assert.ok(manager.includes('denyAnalyticsConsentInMemory'));
  assert.ok(manager.includes('clearFeedAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearFeedCardAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearSponsorAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearAnonymousSponsorAnalyticsQueue()'));
  assert.ok(store.includes('clearStream(userId: string, stream: SignedInAnalyticsStream)'));
  assert.ok(feed.includes('createConsentBoundAbortSignal'));
  assert.ok(comments.includes('createConsentBoundAbortSignal'));
  assert.ok(anonymous.includes('createConsentBoundAbortSignal'));
  assert.ok(sponsor.includes('createConsentBoundAbortSignal'));
  assert.ok(feed.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(anonymous.includes("hasAnalyticsConsent('serviceImprovement', null)"));
  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', null)"));
});

test('declining sponsor measurement preserves delivery and campaign-day totals without visitor tracking', async () => {
  const [feed, selectRoute, eventRoute, bootstrap, migration, entryMap, placementRules] = await Promise.all([
    read('../src/components/topic/TopicFeedCore.tsx'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../supabase/migrations/20261120180000_analytics_consent_and_sponsor_opt_out.sql'),
    read('../src/lib/feed-entry-map.ts'),
    read('../src/lib/feed-card-placement-registry.ts'),
  ]);

  assert.ok(feed.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes('const sessionId = measurementEnabled'));
  assert.ok(feed.includes('if (result.campaigns.length > 0)'));
  assert.ok(feed.includes('handleConsentChange'));
  assert.ok(feed.includes("entry.type === 'sponsor' ? { ...entry, sessionId: '' } : entry"));
  assert.ok(entryMap.includes('if (sponsorInventory.campaigns.length === 0) return []'));
  assert.ok(entryMap.includes("sessionId: sponsorInventory.sessionId ?? ''"));
  assert.ok(placementRules.includes('if (result && result.campaigns.length === 0) return null;'));
  assert.ok(!placementRules.includes('!result.sessionId'));

  assert.ok(selectRoute.includes('const measurementSessionId: string | null'));
  assert.ok(selectRoute.includes('p_session_token: measurementSessionId'));
  assert.ok(selectRoute.includes('p_session_id: measurementSessionId'));
  assert.ok(eventRoute.includes('if (!consent.sponsorMeasurement) return respond(request, { recorded: false });'));

  for (const sql of [bootstrap, migration]) {
    assert.ok(sql.includes("p_session_token !~* '^[0-9a-f-]{36}$'"));
    assert.ok(sql.includes('IF p_session_token IS NOT NULL THEN'));
    assert.ok(sql.includes('CASE WHEN p_session_token IS NULL THEN true ELSE'));
    assert.ok(sql.includes('IF v_session_id IS NOT NULL THEN'));
    assert.ok(sql.includes('INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,served_count)'));
    assert.ok(sql.includes('INSERT INTO catho_private.sponsor_campaign_daily'));
    assert.ok(sql.includes('v_session_id := CASE WHEN coalesce(v_sponsor_measurement, false) THEN p_session_id ELSE NULL END'));
  }
});

test('signed-out visitors can receive public Top Comments and eligible sponsor cards', async () => {
  const [feed, commentsRoute, commentCard, sponsorRoute] = await Promise.all([
    read('../src/components/topic/TopicFeedCore.tsx'),
    read('../src/app/api/content/top-comments/route.ts'),
    read('../src/components/topic/TopCommentFeedCard.tsx'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
  ]);

  assert.ok(feed.includes('const loadMoreTopComments = useCallback(async () =>'));
  assert.ok(!feed.includes('if (!userId) return;'));
  assert.ok(commentsRoute.includes('get_top_feed_comments'));
  assert.ok(!commentsRoute.includes('getAuthenticatedUserFromRequest'));
  assert.ok(commentCard.includes('userId: string | null'));
  assert.ok(sponsorRoute.includes('const isAnonymous = !auth.user'));
  assert.ok(sponsorRoute.includes('p_session_token: measurementSessionId'));
  assert.ok(sponsorRoute.includes('campaigns: data.campaigns'));
});

test('Vercel analytics and performance telemetry are gated by service-improvement consent', async () => {
  const [layout, analytics, speed] = await Promise.all([
    read('../src/app/layout.tsx'),
    read('../src/components/providers/PrivacySafeAnalytics.tsx'),
    read('../src/components/providers/PrivacySafeSpeedInsights.tsx'),
  ]);

  assert.ok(layout.includes('<PrivacySafeAnalytics />'));
  assert.ok(layout.includes('<PrivacySafeSpeedInsights />'));
  assert.ok(analytics.includes('beforeSend={beforeSend}'));
  assert.ok(analytics.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(analytics.includes('if (loading || !enabled) return null;'));
  assert.ok(analytics.includes('redactAnalyticsEvent(event)'));
  assert.ok(speed.includes('<SpeedInsights beforeSend={beforeSend} />'));
  assert.ok(speed.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(speed.includes('if (loading || !enabled) return null;'));
  assert.ok(speed.includes('sanitiseSpeedInsightsEvent(event)'));
});

test('privacy assessment distinguishes special-category risk and keeps personalisation separate', async () => {
  const [assessment, manager, account] = await Promise.all([
    read('../docs/analytics-data-protection-impact-assessment.md'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/components/account/PersonalizationAccountSection.tsx'),
  ]);

  assert.ok(assessment.includes('Article 6'));
  assert.ok(assessment.includes('Article 9'));
  assert.ok(assessment.includes('religious or philosophical beliefs'));
  assert.ok(assessment.includes('not a legal opinion'));
  assert.ok(manager.includes('Recommendation personalisation remains controlled separately'));
  assert.ok(account.includes('personalization'));
});
