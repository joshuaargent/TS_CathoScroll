import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('signed-in analytics requires consent while signed-out aggregates use a separate objection', async () => {
  const [topicViewer, commentViewer, topicRoute, commentRoute, topicClient, commentClient, anonymousClient] = await Promise.all([
    read('../src/components/topic/TopicSwipeViewer.tsx'),
    read('../src/components/topic/TopCommentFeedCard.tsx'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
    read('../src/lib/anonymous-feed-analytics-client.ts'),
  ]);

  assert.ok(topicViewer.includes('recordAnonymousFeedEvent'));
  assert.ok(commentViewer.includes('recordAnonymousFeedEvent'));
  assert.ok(topicRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(commentRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(topicRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(commentRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(topicClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(commentClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(anonymousClient.includes("localStorage.getItem(anonymousAnalyticsPreferenceKey) === 'false'"));
  assert.ok(anonymousClient.includes('isAnonymousFeedAnalyticsEnabled'));
  assert.ok(!anonymousClient.includes('hasAnalyticsConsent'));
  assert.ok(anonymousClient.includes('setAnonymousFeedAnalyticsEnabled'));

  assert.ok(!anonymousClient.includes('userId'));
});


test('Vercel analytics preserves safe page routes and redacts sensitive content identifiers', async () => {
  const layout = await read('../src/app/layout.tsx');
  const analytics = await read('../src/components/providers/PrivacySafeAnalytics.tsx');
  const speed = await read('../src/components/providers/PrivacySafeSpeedInsights.tsx');
  assert.ok(layout.includes('<PrivacySafeAnalytics />'));
  assert.ok(layout.includes('<PrivacySafeSpeedInsights />'));
  assert.ok(analytics.includes('beforeSend={beforeSend}'));
  assert.ok(analytics.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(analytics.includes('if (loading || !enabled) return null;'));
  assert.ok(analytics.includes('return null;'));
  assert.ok(analytics.includes('redactAnalyticsEvent(event)'));
  assert.ok(analytics.includes('url.search = \'\''));
  assert.ok(analytics.includes('url.hash = \'\''));
  assert.ok(analytics.includes('topic|topics'));
  assert.ok(speed.includes('<SpeedInsights beforeSend={beforeSend} />'));
  assert.ok(speed.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(speed.includes('if (loading || !enabled) return null;'));
  assert.ok(speed.includes('sanitiseSpeedInsightsEvent(event)'));
  assert.ok(speed.includes('url.search = \'\''));
  assert.ok(speed.includes('topic|topics'));
  assert.ok(layout.includes('<meta name="referrer" content="strict-origin" />'));
});

test('analytics DPIA documents active signed-in analytics, signed-out aggregates and the measured purpose', async () => {
  const assessment = await read('../docs/analytics-data-protection-impact-assessment.md');
  assert.ok(assessment.includes('signed-in'));
  assert.ok(assessment.includes('signed-out'));
  assert.ok(assessment.includes('Article 6'));
  assert.ok(assessment.includes('Those scores are not religious-affiliation labels or classifications, but may reveal interests in sensitive topics'));
  assert.ok(assessment.includes('Article 9'));
  assert.ok(assessment.includes('not a legal opinion'));
});


test('admin sponsor analytics reports signed-out served totals only', async () => {
  const hub = await read('../src/components/admin/AdminAnalyticsHub.tsx');
  const detail = await read('../src/app/admin/analytics/[kind]/[id]/page.tsx');

  assert.ok(hub.includes('Campaign/day served totals only; signed-out viewability and clicks are not collected'));
  assert.ok(hub.includes('Opted-in signed-in clicks ÷ viewable impressions; signed-out deliveries are excluded'));
  assert.ok(hub.includes('Opted-in signed-in viewable impressions ÷ signed-in served placements; signed-out viewability is not collected'));
  assert.ok(detail.includes('Signed-out measurement" value="Served totals only"'));
  assert.ok(detail.includes('No signed-out viewability, clicks, CTR or per-visitor frequency are collected'));
  assert.ok(!detail.includes('Anonymous viewable / clicks'));
  assert.ok(!detail.includes('fmt(row.anonymous_viewable_impressions)'));
  assert.ok(!detail.includes('fmt(row.anonymous_clicks)'));
});


test('sponsor portal and RPC do not report signed-out viewability or clicks', async () => {
  const portal = await read('../src/components/sponsor/SponsorPortal.tsx');
  const bootstrap = await read('../docs/cathoscroll-database-bootstrap.sql');
  const upgrade = await read('../docs/analytics-consent-and-sponsor-opt-out-upgrade.sql');
  const extract = (sql) => {
    const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics');
    const end = sql.indexOf('$function$;', start);
    return start >= 0 && end > start ? sql.slice(start, end) : '';
  };
  const bootstrapFunction = extract(bootstrap);
  const upgradeFunction = extract(upgrade);

  assert.ok(portal.includes('Signed-out served'));
  assert.ok(portal.includes('Signed-in CTR'));
  assert.ok(portal.includes('Signed-out delivery is reported as served totals only'));
  assert.ok(!portal.includes('Anonymous viewable'));
  assert.ok(!portal.includes('Anonymous clicks'));
  assert.ok(!portal.includes('Combined CTR'));

  for (const [label, definition] of [
    ['canonical bootstrap', bootstrapFunction],
    ['existing-database upgrade', upgradeFunction],
  ]) {
    assert.ok(definition, label + ' must define get_sponsor_campaign_analytics');
    assert.ok(definition.includes("'anonymous_served'"));
    assert.ok(definition.includes("'click_through_rate'"));
    assert.ok(definition.includes('m.clicks::numeric * 100 / m.viewable_impressions'));
    assert.ok(!/anonymous_viewable_impressions|anonymous_clicks|total_viewable_impressions|total_clicks/.test(definition));
  }
  assert.ok(upgrade.includes('GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role'));
});
