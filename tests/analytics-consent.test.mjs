import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function getLastFunctionDefinition(sql, name) {
  const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION ' + name);
  if (start < 0) return null;
  const end = sql.indexOf('$function$;', start);
  return end > start ? sql.slice(start, end) : null;
}

test('optional analytics consent is explicit, purpose-specific and off by default', async () => {
  const [consent, manager, layout, native, cookies, account, signup, anonymous] = await Promise.all([
    read('../src/lib/analytics-consent.ts'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/layout.tsx'),
    read('../native/main.tsx'),
    read('../src/app/cookies/page.tsx'),
    read('../src/components/account/AnalyticsConsentSettingsPanel.tsx'),
    read('../src/components/auth/SignupFormView.tsx'),
    read('../src/components/privacy/AnonymousAnalyticsPreference.tsx'),
  ]);

  assert.ok(consent.includes('serviceImprovement: false'));
  assert.ok(consent.includes('sponsorMeasurement: false'));
  assert.ok(consent.includes('analyticsConsentVersion = 1'));
  assert.ok(consent.includes('syncPending: options.syncPending ?? Boolean(userId)'));
  assert.ok(consent.includes('deniedOverrides'));
  assert.match(consent, /if \(!userId\) return false/);
  assert.match(manager, /legacySignedOutConsent = readAnalyticsConsent\(null\)/);
  assert.match(manager, /saveAnalyticsConsent\(\{ serviceImprovement: false, sponsorMeasurement: false \}, null/);
  assert.doesNotMatch(manager, /setVisible\(true\)/);
  assert.ok(manager.includes('if (loading || !visible) return null;'));
  assert.ok(account.includes('Service improvement analytics'));
  assert.ok(account.includes('Sponsor measurement'));
  assert.ok(account.includes('Required while personalisation is on'));
  assert.ok(account.includes('clearAnalyticsConsentQueues(userId, previous, next)'));
  assert.ok(signup.includes('name="personalizationConsent"'));
  assert.ok(signup.includes('name="serviceImprovementConsent"'));
  assert.ok(signup.includes('name="sponsorMeasurementConsent"'));
  assert.ok(signup.includes('I explicitly consent'));
  assert.ok(signup.includes('Required while personalisation is enabled.'));
  assert.ok(anonymous.includes('Turn off aggregate measurement'));
  assert.ok(anonymous.includes('daily totals without visitor or session IDs'));
  assert.ok(layout.includes('<WebAnalyticsConsentManager />'));
  assert.ok(native.includes('<AnalyticsConsentManager'));
  assert.ok(native.includes("loading={authStatus === 'loading' || checkingAccount}"));
  assert.ok(cookies.includes('AnalyticsConsentSettingsButton'));
  assert.ok(cookies.includes('<AnonymousAnalyticsPreference />'));
});

test('account consent sync is identity-bound, retryable and enforced server-side', async () => {
  const [manager, route, serverConsent, topicRoute, commentRoute, sponsorRoute, migration, personalizationUpgrade, bootstrap, security] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/api/privacy/analytics-consent/route.ts'),
    read('../src/lib/analytics-consent-server.ts'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
    read('../docs/personalization-analytics-upgrade.sql'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../src/lib/supabase/admin.ts'),
  ]);

  assert.ok(manager.includes("window.addEventListener('online', syncServerConsent)"));
  assert.ok(manager.includes('local.syncPending || !remote.exists'));
  assert.ok(manager.includes('pendingChoices'));
  assert.ok(manager.includes('serviceImprovement: remote.personalizationEnabled ? true : local.serviceImprovement'));
  assert.ok(manager.includes('sponsorMeasurement: local.sponsorMeasurement'));
  assert.ok(manager.includes('if (!managingRef.current)'));
  assert.ok(manager.includes('managingRef.current = true'));
  assert.ok(manager.includes('effectivePersonalizationStatusKnown, saving, syncServerConsent'));
  assert.ok(manager.includes('personalizationStateUserId === userId'));
  assert.ok(manager.includes('previous?.serviceImprovement === true && !next.serviceImprovement'));

  assert.ok(manager.includes('clearAnalyticsConsentQueues(userId, previous, next)'));
  assert.ok(manager.includes('getAccessToken(expectedUserId)'));
  assert.ok(manager.includes('}, [loading, userId]);'));
  assert.ok(manager.includes('activeUserIdRef.current === expectedUserId'));
  assert.ok(manager.includes('consentMutationRef.current === requestGeneration'));
  assert.ok(manager.includes('readLocalChoiceSnapshot() === localChoiceSnapshot'));
  assert.ok(manager.includes('markOwnChoiceWrite();'));
  assert.ok(manager.includes('window.addEventListener(analyticsConsentChangeEvent, onConsentChange)'));
  assert.ok(manager.includes('event.key === storageKey'));
  assert.ok(manager.includes('syncAbortRef.current?.abort()'));
  assert.ok(route.includes("request.headers.get('X-Catho-Expected-User-Id')"));
  assert.ok(route.includes('Account changed during consent synchronisation.'));
  assert.ok(route.includes('X-Catho-Expected-User-Id'));
  assert.ok(route.includes('set_user_analytics_consent'));
  assert.ok(security.includes('if (origin !== null) return origin === requestOrigin;'));
  assert.ok(security.includes("request.headers.get('sec-fetch-site') === 'same-origin'"));
  assert.ok(security.includes('new URL(referer).origin === requestOrigin'));
  assert.ok(serverConsent.includes('get_user_analytics_consent'));
  assert.ok(serverConsent.includes('personalizationEnabled'));
  assert.ok(manager.includes('remote.personalizationEnabled'));
  assert.ok(bootstrap.includes('p_service_improvement IS NOT TRUE'));
  assert.ok(manager.includes('clearAnalyticsConsentQueues'));
  assert.ok(topicRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(commentRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(sponsorRoute.includes('getStoredAnalyticsConsent(auth.user.id)'));
  assert.ok(migration.includes('user_analytics_consents'));
  assert.ok(migration.includes('user_analytics_consent_history'));
  const setter = getLastFunctionDefinition(migration, 'public.set_user_analytics_consent') ?? '';
  assert.ok(setter.indexOf('FROM auth.users AS account WHERE account.id = p_user_id FOR UPDATE') < setter.indexOf('FROM catho_private.user_analytics_consents'));
  for (const sql of [migration, bootstrap]) {
    for (const name of ['public.record_feed_analytics_events', 'public.record_sponsor_campaign_event', 'public.get_weighted_sponsor_campaigns']) {
      const body = getLastFunctionDefinition(sql, name);
      assert.ok(body, name + ' must be present as a complete final function in both install paths');
      assert.ok(body.toLowerCase().includes('for key share'));
      assert.ok(body.toLowerCase().indexOf('for key share') < body.toLowerCase().indexOf('for share'));
    }
    const setter = getLastFunctionDefinition(sql, 'public.set_user_analytics_consent') ?? '';
    assert.ok(setter.indexOf('FOR UPDATE') < setter.indexOf('FROM catho_private.user_analytics_consents'));
  }
  for (const sql of [personalizationUpgrade, bootstrap]) {
    const name = 'public.record_feed_card_analytics_events';
    const definition = getLastFunctionDefinition(sql, name);
    assert.ok(definition, name + ' must be present in both install paths');
    const body = definition.toLowerCase();
    assert.ok(body.includes('for key share'));
    assert.ok(body.indexOf('for key share') < body.indexOf('for share'));
  }
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
  assert.ok(consent.includes("window.addEventListener('storage', onStorageChange)"));
  assert.ok(consent.includes('event.key === storageKeyForUser(expectedUserId)'));
  assert.ok(manager.includes('denyAnalyticsConsentInMemory'));
  assert.ok(manager.includes('clearFeedAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearFeedCardAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearSponsorAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearAnonymousSponsorAnalyticsQueue()'));
  assert.ok(manager.includes('saveAnalyticsConsent(interim, userId, { syncPending: Boolean(userId) })'));
  assert.ok(store.includes('clearStream(userId: string, stream: SignedInAnalyticsStream)'));
  assert.ok(feed.includes('createConsentBoundAbortSignal'));
  assert.ok(feed.includes("consentRequest.signal.aborted || !hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes('createConsentBoundAbortSignal'));
  assert.ok(comments.includes("consentRequest.signal.aborted || !hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.doesNotMatch(anonymous, /createConsentBoundAbortSignal/);
  assert.ok(sponsor.includes('createConsentBoundAbortSignal'));
  assert.ok(sponsor.includes("!accessToken || consentRequest.signal.aborted || !hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(anonymous.includes("localStorage.getItem(anonymousAnalyticsPreferenceKey) === 'false'"));
  assert.ok(manager.includes('clearAnonymousSponsorAnalyticsQueue()'));

  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', null)"));
});

test('declining sponsor measurement preserves delivery and campaign-day totals without visitor tracking', async () => {
  const [feed, selectRoute, eventRoute, sponsorClient, bootstrap, migration, entryMap, placementRules] = await Promise.all([
    read('../src/components/topic/TopicFeedCore.tsx'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../src/lib/sponsor-analytics-client.ts'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
    read('../src/lib/feed-entry-map.ts'),
    read('../src/lib/feed-card-placement-registry.ts'),
  ]);

  assert.ok(feed.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes('const sessionId = measurementEnabled'));
  assert.match(feed, /const measurementEnabled = Boolean\(userId && hasAnalyticsConsent\('sponsorMeasurement', userId\)\)/);
  assert.doesNotMatch(feed, /sponsorMeasurementConsent: measurementEnabled/);
  assert.ok(sponsorClient.includes('sponsorMeasurementConsent: true'));
  assert.ok(feed.includes('if (result.campaigns.length > 0)'));
  assert.ok(feed.includes('handleConsentChange'));
  assert.ok(feed.includes("entry.type === 'sponsor' ? { ...entry, sessionId: '' } : entry"));
  assert.ok(entryMap.includes('if (sponsorInventory.campaigns.length === 0) return []'));
  assert.ok(entryMap.includes("sessionId: sponsorInventory.sessionId ?? ''"));
  assert.ok(placementRules.includes('if (result && result.campaigns.length === 0) return null;'));
  assert.ok(!placementRules.includes('!result.sessionId'));

  assert.ok(selectRoute.includes('const measurementSessionId: string | null'));
  assert.ok(selectRoute.includes('p_session_token: measurementSessionId'));
  assert.ok(selectRoute.includes('sponsorMeasurementEnabled = consent.sponsorMeasurement && parsed.value.sessionId !== null;'));
  assert.ok(selectRoute.includes('// Detailed Sponsor measurement is account-only.'));
  assert.ok(eventRoute.includes('if (!auth.user) return respond(request, { recorded: false }, 403);'));
  assert.ok(eventRoute.includes('const consent = await getStoredAnalyticsConsent(auth.user.id);'));
  assert.ok(eventRoute.includes('if (!consent.sponsorMeasurement) return respond(request, { recorded: false });'));
  assert.doesNotMatch(eventRoute, /sponsorMeasurementConsent/);
  assert.ok(selectRoute.includes('p_session_id: measurementSessionId'));
  assert.ok(eventRoute.includes('if (!consent.sponsorMeasurement) return respond(request, { recorded: false });'));

  for (const sql of [bootstrap, migration]) {
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.get_user_analytics_consent(uuid) FROM PUBLIC, anon, authenticated, service_role;'));
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.get_user_analytics_consent(uuid) TO service_role;'));
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;'));
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;'));
    assert.match(sql, /p_session_token remains in the RPC signature for compatibility but is intentionally ignored/);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public.record_anonymous_sponsor_campaign_event/);
    assert.doesNotMatch(sql, /CREATE TABLE(?: IF NOT EXISTS)? catho_private\\.anonymous_sponsor_events/);\n    assert.doesNotMatch(sql, /CREATE TABLE(?: IF NOT EXISTS)? catho_private\\.anonymous_sponsor_session_frequency/);
    assert.ok(sql.includes('INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,served_count)'));
    assert.ok(sql.includes('INSERT INTO catho_private.sponsor_campaign_daily'));
    assert.ok(sql.includes('v_session_id := CASE WHEN coalesce(v_sponsor_measurement, false) THEN p_session_id ELSE NULL END'));
    assert.ok(sql.includes('IF v_session_id IS NOT NULL THEN'));
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
  const [assessment, manager, account, analyticsSettings] = await Promise.all([
    read('../docs/analytics-data-protection-impact-assessment.md'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/components/account/PersonalizationAccountSection.tsx'),
    read('../src/components/account/AnalyticsConsentSettingsPanel.tsx'),
  ]);

  assert.ok(assessment.includes('Article 6'));
  assert.ok(assessment.includes('Article 9'));
  assert.ok(assessment.includes('religious or philosophical beliefs'));
  assert.ok(assessment.includes('not a legal opinion'));
  assert.ok(manager.includes('Personalisation requires Service improvement analytics; Sponsor measurement remains independent.'));
  assert.ok(account.includes('personalization'));
  assert.ok(account.includes('I explicitly consent to CathoScroll using my account actions, selected interests and reading analytics'));
  assert.ok(analyticsSettings.includes('Required while personalisation is on.'));
  assert.ok(account.includes('AnalyticsConsentSettingsPanel'));
});
