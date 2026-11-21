import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('signed-in feed analytics is gated by the account Service improvement choice', async () => {
  const [topicViewer, commentViewer, topicRoute, commentRoute, topicClient, commentClient] = await Promise.all([
    read('../src/components/topic/TopicSwipeViewer.tsx'),
    read('../src/components/topic/TopCommentFeedCard.tsx'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
  ]);

  assert.ok(topicRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(commentRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(topicRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(commentRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(topicClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(commentClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.doesNotMatch(topicViewer + commentViewer, /recordAnonymousFeedEvent|anonymous-feed-analytics-client/);
});

test('Vercel analytics preserves safe page routes and is consent-gated', async () => {
  const layout = await read('../src/app/layout.tsx');
  const analytics = await read('../src/components/providers/PrivacySafeAnalytics.tsx');
  const speed = await read('../src/components/providers/PrivacySafeSpeedInsights.tsx');
  assert.ok(layout.includes('<PrivacySafeAnalytics />'));
  assert.ok(layout.includes('<PrivacySafeSpeedInsights />'));
  assert.ok(analytics.includes('beforeSend={beforeSend}'));
  assert.ok(analytics.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(analytics.includes('if (loading || !enabled) return null;'));
  assert.ok(analytics.includes('redactAnalyticsEvent(event)'));
  assert.ok(analytics.includes("url.search = ''"));
  assert.ok(analytics.includes("url.hash = ''"));
  assert.ok(speed.includes('<SpeedInsights beforeSend={beforeSend} />'));
  assert.ok(speed.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(speed.includes('sanitiseSpeedInsightsEvent(event)'));
});

test('privacy and analytics surfaces explicitly exclude anonymous engagement measurement', async () => {
  const [privacy, cookies, hub, detail, sponsorPortal, adminPage, consentManager] = await Promise.all([
    read('../src/app/privacy/page.tsx'),
    read('../src/app/cookies/page.tsx'),
    read('../src/components/admin/AdminAnalyticsHub.tsx'),
    read('../src/app/admin/analytics/[kind]/[id]/page.tsx'),
    read('../src/components/sponsor/SponsorPortal.tsx'),
    read('../src/app/admin/analytics/page.tsx'),
    read('../src/components/privacy/AnalyticsConsentManager.tsx'),
  ]);
  for (const source of [privacy, cookies]) {
    assert.match(source, /(?:do not collect|does not collect) anonymous/i);
    assert.doesNotMatch(source, /AnonymousAnalyticsPreference|signed-out topic\/comment daily aggregates|campaign\/day served totals/i);
  }
  for (const source of [hub, detail, sponsorPortal, adminPage]) {
    assert.doesNotMatch(source, /anonymous_served|anonymous_impressions|Signed-out served|Campaign deliveries|served totals/i);
  }
  assert.doesNotMatch(consentManager, /anonymous-feed-analytics-client|AnonymousAnalyticsPreference|clearAnonymousSponsorAnalyticsQueue/);
});

test('sponsor delivery is available without consent and creates no delivery counter', async () => {
  const [route, card, client, bootstrap, upgrade] = await Promise.all([
    read('../src/app/api/content/sponsored-campaigns/route.ts'),
    read('../src/components/topic/SponsorFeedCard.tsx'),
    read('../src/lib/sponsor-analytics-client.ts'),
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql'),
  ]);
  assert.match(route, /!sponsorMeasurementEnabled[\s\S]*?get_anonymous_sponsor_campaigns/);
  assert.match(route, /get_weighted_sponsor_campaigns/);
  assert.match(card, /if \(previewMode \|\| !sponsorMeasurementEnabled \|\| !userId\) return false/);
  assert.match(card, /recordSponsorCampaignEvent\(userId/);
  assert.doesNotMatch(card + client, /recordAnonymousSponsorCampaignEvent|anonymousQueue|AnonymousQueuedSponsor/);
  for (const sql of [bootstrap, upgrade]) {
    const finalModel = sql.slice(sql.lastIndexOf('-- FINAL ANALYTICS MODEL'));
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_feed_analytics_daily/);
    assert.match(finalModel, /DROP TABLE IF EXISTS catho_private\.anonymous_sponsor_campaign_daily/);
    assert.match(finalModel, /DROP FUNCTION IF EXISTS public\.record_anonymous_feed_analytics/);
    const selectorStart = finalModel.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_anonymous_sponsor_campaigns');
    const selectorEnd = finalModel.indexOf('$function$;', selectorStart);
    const selector = finalModel.slice(selectorStart, selectorEnd);
    assert.doesNotMatch(selector, /INSERT INTO|served_count|anonymous_sponsor_campaign_daily/);
    assert.doesNotMatch(finalModel, /UPDATE public\.sponsor_campaigns SET served_count=served_count\+1/);
  }
});

test('general feed ranking does not consume anonymous analytics or sponsor activity', async () => {
  const [bootstrap, ranking, native] = await Promise.all([
    read('../docs/cathoscroll-database-bootstrap.sql'),
    read('../docs/general-feed-ranking.md'),
    read('../native/main.tsx'),
  ]);
  const finalRanking = bootstrap.slice(bootstrap.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_public_general_topic_page'));
  const rankingEnd = finalRanking.indexOf('$function$;');
  assert.ok(rankingEnd > 0);
  assert.doesNotMatch(finalRanking.slice(0, rankingEnd), /anonymous_feed_analytics_daily|sponsor_campaign/);
  assert.match(ranking, /does not use anonymous engagement analytics or sponsor activity/i);
  assert.doesNotMatch(native, /NativeAnonymousAnalyticsOutbox|configureAnonymousFeedAnalyticsOutbox/);
});
