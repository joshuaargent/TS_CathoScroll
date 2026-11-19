import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('anonymous feed ingestion is bounded, rate-limited and service-role mediated', () => {
  const route = read('../src/app/api/analytics/anonymous-events/route.ts');
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  assert.match(route, /readBoundedJson/);
  assert.match(route, /checkApiRateLimit/);
  assert.match(route, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(route, /record_anonymous_feed_analytics/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_anonymous_feed_analytics\(jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_anonymous_feed_analytics\(jsonb\) TO service_role/);
});

test('anonymous analytics stores daily entity aggregates without visitor identifiers', () => {
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  assert.match(sql, /CREATE TABLE catho_private\.anonymous_feed_analytics_daily/);
  assert.match(sql, /CREATE TABLE catho_private\.anonymous_feed_event_receipts/);
  assert.match(sql, /event_date date NOT NULL/);
  assert.match(sql, /entity_type text NOT NULL CHECK \(entity_type IN \('topic','comment'\)\)/);
  assert.match(sql, /anonymous_feed_event_receipts_received_at_idx/);
  assert.match(sql, /INTERVAL '7 days'/i);
  assert.doesNotMatch(sql.slice(sql.lastIndexOf('CREATE TABLE catho_private.anonymous_feed_analytics_daily'), sql.indexOf('-- END ANONYMOUS ANALYTICS ROLLOUT')), /user_id|session_id|visitor_id/i);
});

test('signed-out topic and Top Comments cards emit aggregate events', () => {
  const topic = read('../src/components/topic/TopicSwipeViewer.tsx');
  const comment = read('../src/components/topic/TopCommentFeedCard.tsx');
  const client = read('../src/lib/anonymous-feed-analytics-client.ts');
  assert.match(topic, /recordAnonymousFeedEvent\('topic', currentTopicId, 'impression'\)/);
  assert.match(topic, /'viewable_impression'/);
  assert.match(topic, /'active_duration'/);
  assert.match(topic, /'skip'/);
  assert.match(topic, /'completion'/);
  assert.match(comment, /recordAnonymousFeedEvent\('comment', activeCommentId, 'impression'\)/);
  assert.match(comment, /'viewable_impression'/);
  assert.match(comment, /'active_duration'/);
  assert.match(comment, /'open'/);
  assert.match(client, /recentEventKeys/);
});

test('native anonymous analytics uses the configured server origin and trusted CORS path', () => {
  const client = read('../src/lib/anonymous-feed-analytics-client.ts');
  const admin = read('../src/lib/supabase/admin.ts');
  const route = read('../src/app/api/analytics/anonymous-events/route.ts');
  assert.match(client, /siteConfig\.url/);
  assert.match(client, /window\.location\.protocol === 'capacitor:'/);
  assert.match(admin, /allowAnonymousNative = false/);
  assert.match(admin, /nativeOrigin\(request\) &&/);
  assert.match(route, /isSameOriginOrNativeRequest\(request, true\)/);
  const native = read('../native/main.tsx');
  assert.match(native, /siteConfig\.url/);
  assert.match(native, /generalRanked=\{feedGeneralRanked\}/);
});

test('anonymous sponsor selection and event recording are separate from account-linked delivery', () => {
  const selectRoute = read('../src/app/api/content/sponsored-campaigns/route.ts');
  const eventRoute = read('../src/app/api/content/sponsor-campaign-events/route.ts');
  const card = read('../src/components/topic/SponsorFeedCard.tsx');
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  assert.match(selectRoute, /get_anonymous_sponsor_campaigns/);
  assert.match(selectRoute, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(eventRoute, /record_anonymous_sponsor_campaign_event/);
  assert.match(eventRoute, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(card, /userId: string \| null/);
  assert.match(sql, /CREATE TABLE catho_private\.anonymous_sponsor_session_frequency/);
  assert.match(sql, /CREATE TABLE catho_private\.anonymous_sponsor_campaign_daily/);
  assert.match(sql, /least\(campaign\.frequency_cap_per_user_total,5\)/);
  assert.match(sql, /cathoscroll-anonymous-analytics-prune/);
});

test('all analytics surfaces report anonymous counts separately', () => {
  const overview = read('../src/app/admin/analytics/page.tsx');
  const hub = read('../src/components/admin/AdminAnalyticsHub.tsx');
  const detail = read('../src/app/admin/analytics/[kind]/[id]/page.tsx');
  const contentPage = read('../src/components/admin/ContentAnalyticsDashboard.tsx');
  const topicPage = read('../src/app/topic/[slug]/analytics/page.tsx');
  const categoryPage = read('../src/app/categories/[category]/analytics/page.tsx');
  const sponsorPortal = read('../src/components/sponsor/SponsorPortal.tsx');
  const campaignManager = read('../src/components/admin/SponsorCampaignManager.tsx');
  for (const source of [overview, detail, topicPage, categoryPage]) {
    assert.match(source, /get_admin_anonymous_analytics/);
  }
  for (const source of [hub, detail, contentPage, sponsorPortal, campaignManager]) {
    assert.match(source, /anonymous/i);
  }
  assert.match(hub, /Unique signed-in viewers/);
  assert.match(hub, /no anonymous unique-person count/i);
  assert.match(sponsorPortal, /Anonymous served/);
  assert.match(campaignManager, /anonymous served/);
});

test('general ranking uses anonymous site-wide topic aggregates without viewer history', () => {
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_public_general_topic_page');
  const fn = sql.slice(start);
  assert.ok(start >= 0);
  assert.match(fn, /anonymous_feed_analytics_daily/);
  assert.match(fn, /a\.entity_type='topic'/);
  assert.doesNotMatch(fn, /auth\.uid\(\)|public\.progress/);
});
