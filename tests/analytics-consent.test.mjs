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
  const [consent, manager, layout, native, cookies, account, signup, personalization] = await Promise.all([
    read('../src/lib/analytics-consent.ts'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/layout.tsx'),
    read('../native/main.tsx'),
    read('../src/app/cookies/page.tsx'),
    read('../src/components/account/AnalyticsConsentSettingsPanel.tsx'),
    read('../src/components/auth/SignupFormView.tsx'),
    read('../src/components/account/PersonalizationAccountSection.tsx'),
  ]);

  assert.ok(consent.includes('serviceImprovement: false'));
  assert.ok(consent.includes('sponsorMeasurement: false'));
  assert.ok(consent.includes('analyticsConsentVersion = 2'));
  assert.match(consent, /cathoscroll\.analytics-consent\.v2/);
  assert.match(consent, /parsed\.version !== analyticsConsentVersion/);
  assert.match(manager, /version: analyticsConsentVersion/);
  assert.doesNotMatch(manager, /version: 1,/);
  assert.match(consent, /startsWith\(legacyPrefix \+ '\.account\.'/);
  assert.ok(manager.includes('clearLegacyAnalyticsConsentStorage()'));
  assert.match(consent, /const syncPending = options\.syncPending \?\? Boolean\(userId\)/);
  assert.match(consent, /pendingPurposes: options\.pendingPurposes/);
  assert.ok(consent.includes('deniedOverrides'));
  assert.match(consent, /if \(!userId\) return false/);
  assert.match(manager, /legacySignedOutConsent = readAnalyticsConsent\(null\)/);
  assert.match(manager, /saveAnalyticsConsent\(\{ serviceImprovement: false, sponsorMeasurement: false \}, null/);
  assert.doesNotMatch(manager, /setVisible\(true\)/);
  assert.match(manager, /No first-visit consent modal/);
  assert.ok(manager.includes('if (loading || !visible) return null;'));
  assert.ok(account.includes('Service improvement analytics'));
  assert.ok(account.includes('Sponsor measurement'));
  assert.ok(account.includes('Personalisation requires Service improvement analytics. Enable Service improvement before Personalisation, and turn off Personalisation before withdrawing it. Sponsor measurement remains separate.'));
  assert.ok(account.includes('clearAnalyticsConsentQueues(userId, previous, next)'));
  assert.ok(personalization.includes('offlineCacheAvailable'));
  assert.ok(personalization.includes('const forcedOfflineWithdrawal = !enabled && !personalizationStatusKnown && offlineCacheAvailable'));
  assert.ok(personalization.includes("new CustomEvent('cathoscroll:personalization-consent-changed'"));
  assert.ok(personalization.includes('pendingSync,'));
  assert.ok(personalization.includes('Turn off personalisation offline'));
  assert.ok(personalization.includes('setPersonalizationStatusKnown(true)'));
  assert.ok(personalization.includes('syncNativeConsent(accountUserId, false, true)'));
  assert.ok(account.includes('window.dispatchEvent(new Event(analyticsConsentSyncEvent))'));
  assert.ok(signup.includes('name="personalizationConsent"'));
  assert.ok(signup.includes('name="serviceImprovementConsent"'));
  assert.ok(signup.includes('name="sponsorMeasurementConsent"'));
  assert.ok(signup.includes('I explicitly consent'));
  assert.ok(signup.includes('Personalisation requires Service improvement analytics: select that choice first, and keep it enabled while Personalisation is active.'));
  assert.match(signup, /disabled=\{loading \|\| !online \|\| !serviceImprovementConsent\}/);
  assert.match(signup, /disabled=\{loading \|\| !online \|\| personalizationConsent\}/);
  assert.ok(layout.includes('<WebAnalyticsConsentManager />'));
  assert.ok(native.includes('<AnalyticsConsentManager'));
  assert.ok(native.includes("loading={authStatus === 'loading' || checkingAccount}"));
  assert.ok(cookies.includes('AnalyticsConsentSettingsButton'));
  assert.doesNotMatch(cookies, /AnonymousAnalyticsPreference/);
});

test('account consent sync is identity-bound, retryable and enforced server-side', async () => {
  const [manager, route, serverConsent, consentClient, topicRoute, commentRoute, sponsorRoute, migration, personalizationUpgrade, bootstrap, security] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/app/api/privacy/analytics-consent/route.ts'),
    read('../src/lib/analytics-consent-server.ts'),
    read('../src/lib/analytics-consent.ts'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
    read('../docs/personalization-analytics-upgrade.sql'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../src/lib/supabase/admin.ts'),
  ]);

  assert.ok(manager.includes("window.addEventListener('online', syncServerConsent)"));
  assert.ok(manager.includes('local?.syncPending === true'));
  assert.match(manager, /if \(!remote\.exists\)[\s\S]*?removeItem\(getAnalyticsConsentStorageKey\(expectedUserId\)\)/);
  assert.match(manager, /if \(!remote\.exists\)[\s\S]*?clearAnalyticsConsentQueues\(expectedUserId, null/);
  assert.ok(manager.includes('pendingChoices'));
  assert.match(manager, /serviceImprovement: pendingPurposeSet\.has\('serviceImprovement'\)[\s\S]*?local\.serviceImprovement/);
  assert.match(manager, /sponsorMeasurement: pendingPurposeSet\.has\('sponsorMeasurement'\)[\s\S]*?local\.sponsorMeasurement/);
  assert.ok(manager.includes('if (!managingRef.current)'));
  assert.ok(manager.includes('managingRef.current = true'));
  assert.ok(manager.includes('previous?.serviceImprovement === true && next.serviceImprovement'));

  assert.ok(manager.includes('clearAnalyticsConsentQueues(userId, previous, next)'));
  assert.ok(manager.includes('getAccessToken(expectedUserId)'));
  assert.ok(manager.includes('}, [loading, userId]);'));
  assert.ok(manager.includes('activeUserIdRef.current === expectedUserId'));
  assert.ok(manager.includes('consentMutationRef.current === requestGeneration'));
  assert.ok(manager.includes('readLocalChoiceSnapshot() === localChoiceSnapshot'));
  assert.ok(manager.includes("cathoscroll:personalization-consent-status-request"));
  assert.ok(manager.includes("consent?.pendingSync === true"));
  assert.ok(manager.includes('markOwnChoiceWrite();'));
  assert.ok(manager.includes('window.addEventListener(analyticsConsentChangeEvent, onConsentChange)'));
  assert.ok(manager.includes('event.key === storageKey'));
  assert.ok(manager.includes('syncAbortRef.current?.abort()'));
  assert.ok(route.includes("request.headers.get('X-Catho-Expected-User-Id')"));
  assert.ok(route.includes('Account changed during consent synchronisation.'));
  assert.ok(route.includes('X-Catho-Expected-User-Id'));
  assert.ok(route.includes('set_user_analytics_consent'));
  assert.match(route, /PERSONALISATION_REQUIRES_SERVICE_IMPROVEMENT/);
  assert.match(route, /error\.code === '42501'[\s\S]*?}, 409/);
  assert.match(route, /parsed\.value\.version !== 2/);
  assert.match(route, /p_consent_version: 2/);
  assert.match(manager, /remote\.version !== 2/);
  assert.match(manager, /saved\.version !== 2/);
  assert.ok(security.includes('if (origin !== null) return origin === requestOrigin;'));
  assert.ok(security.includes("request.headers.get('sec-fetch-site') === 'same-origin'"));
  assert.ok(security.includes('new URL(referer).origin === requestOrigin'));
  assert.ok(serverConsent.includes('get_user_analytics_consent'));
  assert.ok(serverConsent.includes('personalizationEnabled'));
  const signupConsent = getLastFunctionDefinition(bootstrap, 'catho_private.capture_signup_personalization_consent') ?? '';
  assert.ok(signupConsent.includes('INSERT INTO catho_private.user_analytics_consents'));
  assert.doesNotMatch(signupConsent, /IF v_service_improvement OR v_sponsor_measurement THEN/);
  assert.match(signupConsent, /v_personalization IS TRUE AND v_service_improvement IS NOT TRUE/);
  assert.match(signupConsent, /Personalisation requires Service improvement analytics/);
  assert.match(signupConsent, /NEW\.id, v_service_improvement, v_sponsor_measurement, 2/);

  assert.match(serverConsent, /const currentConsent = value\.version === 2 && value\.exists === true/);
  assert.match(serverConsent, /serviceImprovement: currentConsent && value\.serviceImprovement/);
  assert.match(serverConsent, /sponsorMeasurement: currentConsent && value\.sponsorMeasurement/);
  assert.match(consentClient, /pendingPurposes: options\.pendingPurposes/);
  assert.match(consentClient, /pendingPurposes/);
  assert.match(manager, /pendingPurposeSet\.has\('serviceImprovement'\)[\s\S]*?remote\.serviceImprovement/);
  assert.match(manager, /pendingPurposeSet\.has\('sponsorMeasurement'\)[\s\S]*?remote\.sponsorMeasurement/);
  assert.match(manager, /personalizationEnabled\?: unknown/);
  assert.match(manager, /setPersonalizationEnabled\(remote\.personalizationEnabled\)/);
  assert.match(bootstrap, /Turn off Personalisation before withdrawing Service improvement analytics/);
  assert.match(bootstrap, /profile_refreshed_at = NULL/);
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
  const [manager, consent, store, feed, comments, sponsor] = await Promise.all([
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/lib/analytics-consent.ts'),
    read('../src/lib/offline/signed-in-analytics-store.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
    read('../src/lib/sponsor-analytics-client.ts'),
  ]);

  assert.ok(consent.includes('denyAnalyticsConsentInMemory'));
  assert.match(consent, /hasSyncedAnalyticsConsent[\s\S]*?consent\?\.syncPending !== true/);
  assert.ok(feed.includes("hasSyncedAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes("hasSyncedAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(sponsor.includes("hasSyncedAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes('window.addEventListener(analyticsConsentChangeEvent, onConsentChange)'));
  assert.ok(comments.includes('window.addEventListener(analyticsConsentChangeEvent, onConsentChange)'));
  assert.ok(sponsor.includes('window.addEventListener(analyticsConsentChangeEvent, onConsentChange)'));
  assert.ok(consent.includes('deniedOverrides.add'));
  assert.ok(consent.includes('new BroadcastChannel'));
  assert.ok(consent.includes("window.addEventListener('storage', onStorageChange)"));
  assert.ok(consent.includes('event.key === storageKeyForUser(expectedUserId)'));
  assert.ok(manager.includes('denyAnalyticsConsentInMemory'));
  assert.ok(manager.includes('clearFeedAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearFeedCardAnalyticsOutbox(userId)'));
  assert.ok(manager.includes('clearSponsorAnalyticsOutbox(userId)'));

  assert.ok(manager.includes('saveAnalyticsConsent(interim, userId, { syncPending: Boolean(userId) })'));
  assert.ok(store.includes('clearStream(userId: string, stream: SignedInAnalyticsStream)'));
  assert.ok(feed.includes('createConsentBoundAbortSignal'));
  assert.ok(feed.includes("consentRequest.signal.aborted || !hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes('createConsentBoundAbortSignal'));
  assert.ok(comments.includes("consentRequest.signal.aborted || !hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(sponsor.includes('createConsentBoundAbortSignal'));
  assert.ok(sponsor.includes("!accessToken || consentRequest.signal.aborted || !hasAnalyticsConsent('sponsorMeasurement', userId)"));
  assert.ok(feed.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(comments.includes("hasAnalyticsConsent('serviceImprovement', userId)"));

  assert.ok(sponsor.includes("hasAnalyticsConsent('sponsorMeasurement', userId)"));
});

test('declining sponsor measurement preserves sponsor delivery without recording delivery counters', async () => {
  const [feed, selectRoute, eventRoute, sponsorClient, card, bootstrap, migration] = await Promise.all([
    read('../src/components/topic/TopicFeedCore.tsx'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../src/lib/sponsor-analytics-client.ts'),
    read('../src/components/topic/SponsorFeedCard.tsx'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  assert.match(feed, /const measurementEnabled = Boolean\(userId && hasAnalyticsConsent\('sponsorMeasurement', userId\)\)/);
  assert.match(selectRoute, /!sponsorMeasurementEnabled[\s\S]*?get_unmeasured_sponsor_campaigns/);
  assert.match(selectRoute, /get_weighted_sponsor_campaigns/);
  assert.match(eventRoute, /if \(!auth\.user\) return respond\(request, \{ recorded: false \}, 403\)/);
  assert.doesNotMatch(sponsorClient + card, /recordAnonymousSponsorCampaignEvent|anonymousQueue/);
  assert.match(card, /if \(previewMode \|\| !sponsorMeasurementEnabled \|\| !userId \|\| !placementReceipt\) return false/);
  for (const sql of [bootstrap, migration]) {
    const finalModel = sql.slice(sql.lastIndexOf('-- FINAL ANALYTICS MODEL'));
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_campaign_daily/);
    assert.match(finalModel, /ALTER TABLE public\.sponsor_campaigns DROP COLUMN IF EXISTS served_count/);
    assert.match(finalModel, /ALTER TABLE catho_private\.sponsor_campaign_daily DROP COLUMN IF EXISTS served_count/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.get_admin_anonymous_analytics/);
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
  assert.ok(sponsorRoute.includes('const measurementSessionId: string | null = auth.user && sponsorMeasurementEnabled'));
  assert.ok(sponsorRoute.includes("rpc('get_unmeasured_sponsor_campaigns'"));
  assert.ok(!sponsorRoute.includes('p_session_token'));
  assert.ok(!sponsorRoute.includes('get_anonymous_sponsor_campaigns'));
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
  assert.ok(analytics.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(analytics.includes('if (loading || !enabled) return null;'));
  assert.ok(analytics.includes('redactAnalyticsEvent(event)'));
  assert.ok(speed.includes('<SpeedInsights beforeSend={beforeSend} />'));
  assert.ok(speed.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(speed.includes('if (loading || !enabled) return null;'));
  assert.ok(speed.includes('sanitiseSpeedInsightsEvent(event)'));
});

test('privacy assessment distinguishes special-category risk and enforces the personalisation dependency', async () => {
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
  assert.ok(manager.includes('Personalisation requires Service improvement analytics; turn off Personalisation before withdrawing Service improvement. Sponsor measurement remains separate.'));
  assert.ok(account.includes('personalization'));
  assert.ok(account.includes('AnalyticsConsentSettingsPanel'));
  assert.ok(account.includes('I explicitly consent to CathoScroll using my account actions and selected interests to personalise my recommendations'));
  assert.ok(analyticsSettings.includes('This choice must remain enabled while Personalisation is active; turn off Personalisation first to withdraw it.'));
});
