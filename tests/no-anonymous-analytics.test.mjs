import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('anonymous analytics clients, APIs, controls and native queues are absent', async () => {
  const [native, privacy, cookies, manager, sponsorClient, apiDirectory, topicPage, categoryPage, contentDashboard, adminHub, entityPage] = await Promise.all([
    read('../native/main.tsx'),
    read('../src/app/privacy/page.tsx'),
    read('../src/app/cookies/page.tsx'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/lib/sponsor-analytics-client.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
    read('../src/app/topic/[slug]/analytics/page.tsx'),
    read('../src/app/categories/[category]/analytics/page.tsx'),
    read('../src/components/admin/ContentAnalyticsDashboard.tsx'),
    read('../src/app/admin/analytics/page.tsx'),
    read('../src/app/admin/analytics/[kind]/[id]/page.tsx'),
  ]);
  assert.doesNotMatch(native, /NativeAnonymousAnalyticsOutbox|configureAnonymousFeedAnalyticsOutbox/);
  assert.doesNotMatch(privacy + cookies + manager, /AnonymousAnalyticsPreference|anonymous-feed-analytics-client/);
  assert.ok(manager.includes("localStorage.removeItem('cathoscroll.anonymous-analytics.enabled.v1')"));
  assert.doesNotMatch(sponsorClient, /recordAnonymousSponsorCampaignEvent|anonymousQueue|AnonymousQueuedSponsor/);
  assert.doesNotMatch(topicPage + categoryPage + contentDashboard + adminHub + entityPage, /get_admin_anonymous_analytics|anonymousAnalytics|anonymous_served|anonymous_viewable/);
  assert.match(apiDirectory, /if \(!auth\.user\) return respond\(request, \{ recorded: false \}, 403\)/);
});

test('canonical database and existing-database upgrade remove anonymous analytics storage', async () => {
  const [bootstrap, upgrade] = await Promise.all([
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  const upgradeRankingStart = upgrade.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_public_general_topic_page');
  const upgradeRankingEnd = upgrade.indexOf('$function$;', upgradeRankingStart);
  assert.ok(upgradeRankingStart >= 0 && upgradeRankingEnd > upgradeRankingStart);
  assert.doesNotMatch(upgrade.slice(upgradeRankingStart, upgradeRankingEnd), /anonymous_feed_analytics_daily|anonymous_feed_event_receipts/);
  for (const sql of [bootstrap, upgrade]) {
    const finalModel = sql.slice(sql.lastIndexOf('-- FINAL ANALYTICS MODEL'));
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.get_admin_anonymous_analytics/);
    assert.match(sql, /get_anonymous_sponsor_campaigns/);
    assert.match(sql, /record_anonymous_sponsor_campaign_event/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.record_anonymous_feed_analytics/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_feed_analytics_daily/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_feed_event_receipts/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_events/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_campaign_daily/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_session_frequency/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.get_anonymous_sponsor_campaigns/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.record_anonymous_sponsor_campaign_event/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS catho_private\.prune_anonymous_analytics/);
    assert.match(finalModel, /cathoscroll-anonymous-analytics-prune/);
    assert.match(finalModel, /cron\.unschedule/);
    assert.match(finalModel, /ALTER TABLE public\.sponsor_campaigns DROP COLUMN IF EXISTS served_count/);
    assert.match(finalModel, /ALTER TABLE catho_private\.sponsor_campaign_daily DROP COLUMN IF EXISTS served_count/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.sponsor_campaign_user_frequency/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.get_admin_sponsor_analytics\(uuid, timestamptz, timestamptz\)/);
    for (const name of [
      'get_sponsor_campaign_analytics',
      'get_admin_sponsor_analytics',
      'get_admin_sponsor_campaign_analytics',
      'get_admin_analytics_overview',
      'get_admin_analytics_series',
      'record_sponsor_campaign_event',
    ]) {
      const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name);
      const end = sql.indexOf('$function$;', start);
      assert.ok(start >= 0 && end > start, name + ' must exist in the final database model');
      assert.doesNotMatch(sql.slice(start, end), /served_count|sponsor_served/);
    }
  }
});

test('sponsor delivery selectors do not record served or anonymous delivery totals', async () => {
  const [bootstrap, upgrade, route, card] = await Promise.all([
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../src/components/topic/SponsorFeedCard.tsx'),
  ]);
  for (const sql of [bootstrap, upgrade]) {
    const finalModel = sql.slice(sql.lastIndexOf('-- FINAL ANALYTICS MODEL'));
    for (const name of ['get_unmeasured_sponsor_campaigns', 'get_weighted_sponsor_campaigns']) {
      const start = finalModel.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name);
      const end = finalModel.indexOf('$function$;', start);
      assert.ok(start >= 0 && end > start);
      const selector = finalModel.slice(start, end);
      assert.doesNotMatch(selector, /served_count|anonymous_sponsor_campaign_daily|sponsor_campaign_user_frequency|INSERT INTO catho_private\.sponsor_campaign_daily/);
      if (name === 'get_weighted_sponsor_campaigns') {
        assert.match(selector, /sponsor_campaign_placement_receipts/);
        assert.match(selector, /measurement_receipt/);
      }
      if (name === 'get_unmeasured_sponsor_campaigns') {
        assert.doesNotMatch(selector, /session_id|session_token/);
      }
    }
  }
  assert.match(route, /!sponsorMeasurementEnabled[\s\S]*?get_unmeasured_sponsor_campaigns/);
  assert.match(card, /!sponsorMeasurementEnabled \|\| !userId/);
  assert.doesNotMatch(card, /recordAnonymousSponsorCampaignEvent/);
});


test('withdrawing analytics consent deletes account-linked events and rebuilds opted-in aggregates', async () => {
  const [bootstrap, upgrade, privacy, cookies] = await Promise.all([
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
    read('../src/app/privacy/page.tsx'),
    read('../src/app/cookies/page.tsx'),
  ]);

  for (const sql of [bootstrap, upgrade]) {
    const serviceStart = sql.lastIndexOf('CREATE OR REPLACE FUNCTION catho_private.purge_user_service_improvement_events');
    const serviceEnd = sql.indexOf('$function$;', serviceStart);
    const sponsorStart = sql.lastIndexOf('CREATE OR REPLACE FUNCTION catho_private.purge_user_sponsor_measurement_events');
    const sponsorEnd = sql.indexOf('$function$;', sponsorStart);
    const consentStart = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.set_user_analytics_consent');
    const consentEnd = sql.indexOf('$function$;', consentStart);
    assert.ok(serviceStart >= 0 && serviceEnd > serviceStart);
    assert.ok(sponsorStart >= 0 && sponsorEnd > sponsorStart);
    assert.ok(consentStart >= 0 && consentEnd > consentStart);

    const servicePurge = sql.slice(serviceStart, serviceEnd);
    const sponsorPurge = sql.slice(sponsorStart, sponsorEnd);
    const consent = sql.slice(consentStart, consentEnd);

    assert.match(servicePurge, /DELETE FROM catho_private\.feed_analytics_events WHERE user_id = p_user_id/);
    assert.match(servicePurge, /DELETE FROM catho_private\.feed_card_analytics_events WHERE user_id = p_user_id/);
    assert.match(servicePurge, /DELETE FROM catho_private\.feed_analytics_daily_viewers WHERE user_id = p_user_id/);
    assert.match(servicePurge, /DELETE FROM catho_private\.feed_card_analytics_daily_viewers WHERE user_id = p_user_id/);
    assert.match(servicePurge, /INSERT INTO catho_private\.feed_analytics_daily/);
    assert.match(servicePurge, /INSERT INTO catho_private\.feed_card_analytics_daily/);
    assert.match(servicePurge, /refresh_user_interest_profile/);

    assert.match(sponsorPurge, /DELETE FROM catho_private\.sponsor_campaign_events WHERE user_id = p_user_id/);
    assert.match(sponsorPurge, /DELETE FROM catho_private\.sponsor_campaign_placement_receipts WHERE user_id = p_user_id/);
    assert.match(sponsorPurge, /INSERT INTO catho_private\.sponsor_campaign_daily/);

    assert.match(consent, /purge_user_service_improvement_events\(p_user_id\)/);
    assert.match(consent, /purge_user_sponsor_measurement_events\(p_user_id\)/);
    assert.match(sql, /DO \$consent_cleanup\$/);
  }

  assert.match(privacy, /Withdrawing Service improvement deletes your account-linked feed and Top Comments events/);
  assert.match(privacy, /Withdrawing Sponsor measurement also deletes your account-linked sponsor event records/);
  assert.match(cookies, /Withdrawing a purpose clears its local queue and deletes its account-linked server event records/);
});
