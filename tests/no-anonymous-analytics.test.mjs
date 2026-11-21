import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('anonymous analytics clients, APIs, controls and native queues are absent', async () => {
  const [native, privacy, cookies, manager, sponsorClient, apiDirectory] = await Promise.all([
    read('../native/main.tsx'),
    read('../src/app/privacy/page.tsx'),
    read('../src/app/cookies/page.tsx'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
    read('../src/lib/sponsor-analytics-client.ts'),
    read('../src/app/api/content/sponsor-campaign-events/route.ts'),
  ]);
  assert.doesNotMatch(native, /NativeAnonymousAnalyticsOutbox|configureAnonymousFeedAnalyticsOutbox/);
  assert.doesNotMatch(privacy + cookies + manager, /AnonymousAnalyticsPreference|anonymous-feed-analytics-client/);
  assert.doesNotMatch(sponsorClient, /recordAnonymousSponsorCampaignEvent|anonymousQueue|AnonymousQueuedSponsor/);
  assert.match(apiDirectory, /if \(!auth\.user\) return respond\(request, \{ recorded: false \}, 403\)/);
});

test('canonical database and existing-database upgrade remove anonymous analytics storage', async () => {
  const [bootstrap, upgrade] = await Promise.all([
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  for (const sql of [bootstrap, upgrade]) {
    const finalModel = sql.slice(sql.lastIndexOf('-- FINAL ANALYTICS MODEL'));
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.get_admin_anonymous_analytics/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.record_anonymous_feed_analytics/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_feed_analytics_daily/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_feed_event_receipts/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_events/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_campaign_daily/);
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
    for (const name of ['get_anonymous_sponsor_campaigns', 'get_weighted_sponsor_campaigns']) {
      const start = finalModel.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name);
      const end = finalModel.indexOf('$function$;', start);
      assert.ok(start >= 0 && end > start);
      const selector = finalModel.slice(start, end);
      assert.doesNotMatch(selector, /served_count|anonymous_sponsor_campaign_daily|INSERT INTO catho_private\.sponsor_campaign_daily/);
    }
  }
  assert.match(route, /!sponsorMeasurementEnabled[\s\S]*?get_anonymous_sponsor_campaigns/);
  assert.match(card, /!sponsorMeasurementEnabled \|\| !userId/);
  assert.doesNotMatch(card, /recordAnonymousSponsorCampaignEvent/);
});
