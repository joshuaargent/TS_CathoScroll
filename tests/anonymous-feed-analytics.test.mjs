import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('anonymous feed ingestion is bounded, rate-limited and service-role mediated', () => {
  const route = read('../src/app/api/analytics/anonymous-events/route.ts');
  const client = read('../src/lib/anonymous-feed-analytics-client.ts');
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  assert.match(route, /readBoundedJson/);
  assert.match(route, /checkApiRateLimit/);
  assert.match(route, /getTrustedClientIp/);
  assert.match(route, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(route, /record_anonymous_feed_analytics/);
  assert.doesNotMatch(route, /serviceImprovementConsent/);
  assert.doesNotMatch(client, /serviceImprovementConsent/);
  assert.match(client, /localStorage.getItem\(anonymousAnalyticsPreferenceKey\) === 'false'/);
  assert.match(client, /isAnonymousFeedAnalyticsEnabled/);
  const recordStart = client.indexOf('export function recordAnonymousFeedEvent(');
  const recordBody = client.slice(recordStart);
  assert.ok(recordStart >= 0);
  assert.ok(recordBody.indexOf('!isAnonymousFeedAnalyticsEnabled()') < recordBody.indexOf('const eventId = uuid()'));
  assert.match(recordBody, /preferenceGeneration !== anonymousPreferenceGeneration/);
  assert.match(client, /await Promise\.allSettled\(\[\.\.\.pendingOutboxWrites\]\)/);
  assert.match(client, /anonymousFlushAbortController\?\.abort\(\)/);
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
  assert.match(sql, /INTERVAL '30 days'/i);
  const tableStart = sql.lastIndexOf('CREATE TABLE catho_private.anonymous_feed_analytics_daily');
  const tableEnd = sql.indexOf('CREATE TABLE catho_private.anonymous_feed_event_receipts', tableStart);
  assert.doesNotMatch(sql.slice(tableStart, tableEnd), /user_id|session_id|visitor_id/i);
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
  assert.match(client, /pendingEvents/);
  assert.match(client, /addEventListener\('online'/);
  assert.match(client, /pendingEvents/);
  assert.match(client, /anonymousAnalyticsPreferenceKey/);
  assert.match(client, /setAnonymousFeedAnalyticsEnabled/);
  assert.doesNotMatch(client, /sessionStorage|indexedDB/);
  assert.match(client, /installAnonymousFeedAnalyticsSync/);
  assert.match(client, /flushAnonymousFeedAnalyticsQueue/);
  assert.doesNotMatch(client, /sessionStorage|indexedDB/);
});

test('native anonymous analytics uses the configured server origin and trusted CORS path', () => {
  const client = read('../src/lib/anonymous-feed-analytics-client.ts');
  const admin = read('../src/lib/supabase/admin.ts');
  const route = read('../src/app/api/analytics/anonymous-events/route.ts');
  assert.match(client, /siteConfig\.url/);
  assert.match(client, /window\.location\.protocol === 'capacitor:'/);
  assert.match(admin, /allowAnonymousNative = false/);
  assert.match(admin, /nativeOrigin\(request\) &&/);
  assert.match(route, /getTrustedClientIp/);
  assert.match(route, /isSameOriginOrNativeRequest\(request, true\)/);
  const native = read('../native/main.tsx');
  assert.match(native, /siteConfig\.url/);
  assert.match(native, /generalRanked=\{feedGeneralRanked\}/);
});

test('anonymous sponsor selection and event recording are separate from account-linked delivery', () => {
  const selectRoute = read('../src/app/api/content/sponsored-campaigns/route.ts');
  const eventRoute = read('../src/app/api/content/sponsor-campaign-events/route.ts');
  const card = read('../src/components/topic/SponsorFeedCard.tsx');
  const feedCore = read('../src/components/topic/TopicFeedCore.tsx');
  const sql = read('../docs/cathoscroll-database-bootstrap.sql');
  assert.match(selectRoute, /get_anonymous_sponsor_campaigns/);
  assert.match(selectRoute, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(eventRoute, /record_anonymous_sponsor_campaign_event/);
  assert.match(eventRoute, /const isAnonymous = !auth\.user \|\| typeof placementKey === 'string'/);
  assert.match(eventRoute, /p_placement_id: placementKey/);
  assert.match(eventRoute, /placementKey/);
  assert.match(card, /recordAnonymousSponsorCampaignEvent/);
  assert.match(card, /const sponsorMeasurementEnabled = hasAnalyticsConsent\('sponsorMeasurement', userId\)/);
  assert.match(card, /const viewablePlacementKey = campaignId && sponsorMeasurementEnabled/);
  assert.match(card, /if \(previewMode \|\| !sponsorMeasurementEnabled\) return false/);
  assert.match(feedCore, /const measurementEnabled = hasAnalyticsConsent\('sponsorMeasurement', userId\)/);
  assert.match(feedCore, /sponsorMeasurementConsent: measurementEnabled/);
  assert.match(feedCore, /ephemeralSponsorSessionId = null/);
  assert.match(feedCore, /Never reuse an anonymous sponsor session token across sign-in\/account changes/);
  assert.match(eventRoute, /isSameOriginOrNativeRequest\(request, true\)/);
  assert.match(card, /userId: string \| null/);
  assert.match(sql, /CREATE TABLE catho_private\.anonymous_sponsor_session_frequency/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE catho_private\.anonymous_feed_analytics_daily,[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /GRANT ALL ON TABLE catho_private\.anonymous_feed_analytics_daily/);
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
  const chartStart = contentPage.indexOf('function LineChart');
  const chartEnd = contentPage.indexOf('function InteractionCard', chartStart);
  const chartSource = contentPage.slice(chartStart, chartEnd);
  assert.match(chartSource, /dates\.length <= 1/);
  assert.match(chartSource, /index \/ \(dates\.length - 1\)/);
  assert.match(chartSource, /dateIndexByDate\.get\(item\.date\)/);
  assert.doesNotMatch(chartSource, /series\.length <= 1/);
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


test('native signed-out analytics is durably queued without visitor or account identity', () => {
  const client = read('../src/lib/anonymous-feed-analytics-client.ts');
  const store = read('../src/lib/offline/anonymous-analytics-store.ts');
  const native = read('../native/main.tsx');
  assert.match(client, /configureAnonymousFeedAnalyticsOutbox/);
  assert.match(client, /installAnonymousFeedAnalyticsSync\(\)/);
  assert.match(client, /persistentOutbox\.pending\(40\)/);
  assert.match(client, /persistentOutbox\.acknowledge/);
  assert.match(store, /offline_anonymous_analytics_outbox/);
  assert.match(store, /maximumEvents = 2000/);
  assert.match(store, /maximumAgeMs = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(store, /INSERT OR IGNORE/);
  assert.match(store, /ORDER BY rowid ASC LIMIT/);
  assert.match(store, /DELETE FROM offline_anonymous_analytics_outbox/);
  assert.match(store, /async clear\(\)/);
  assert.match(client, /setAnonymousFeedAnalyticsEnabled/);
  assert.doesNotMatch(store, /user_id|session_id|visitor_id|account_id/i);
  assert.match(native, /new NativeAnonymousAnalyticsOutbox\(databases\.catalogue\)/);
  assert.match(native, /configureAnonymousFeedAnalyticsOutbox/);
});


test('admin analytics keeps navigation and detailed sections without duplicate summary rows', async () => {
  const hub = read('../src/components/admin/AdminAnalyticsHub.tsx');
  const page = read('../src/app/admin/analytics/page.tsx');
  assert.doesNotMatch(hub, /vs previous/);
  assert.doesNotMatch(hub, /<Metric label="Categories"/);
  assert.match(hub, /count: number\(t\.category_count\)/);
  assert.match(hub, /SectionCard title="Categories"/);
  assert.match(hub, /SectionCard title="Topics"/);
  assert.match(hub, /SectionCard title="Sponsors"/);
  assert.match(hub, /SectionCard title="Comments"/);
  assert.doesNotMatch(page, /previousFrom|comparisonData/);
});

test('admin navigation and shells no longer expose the retired feed preview or Administration eyebrow', async () => {
  const [navigation, adminLoading, contentLoading, contentPage, sponsorsPage, campaignsPage, nativeAdmin] = await Promise.all([
    read('../src/components/admin/AdminNavigation.tsx'),
    read('../src/app/admin/loading.tsx'),
    read('../src/app/admin/content/loading.tsx'),
    read('../src/app/admin/content/page.tsx'),
    read('../src/app/admin/sponsors/page.tsx'),
    read('../src/app/admin/sponsor-campaigns/page.tsx'),
    read('../native/admin.tsx'),
  ]);
  assert.doesNotMatch(navigation, /admin\/previews|Feed card previews/);
  for (const source of [adminLoading, contentLoading, contentPage, sponsorsPage, campaignsPage, nativeAdmin]) {
    assert.doesNotMatch(source, /Administration<\/p>/);
  }
});
