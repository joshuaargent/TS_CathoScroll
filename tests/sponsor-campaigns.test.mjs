import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [bootstrap, feedCore, sponsorCard, campaignManager, deliveryRoute, eventRoute, campaignLib, campaignPage] = await Promise.all([
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/SponsorCampaignManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/content/sponsored-campaigns/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/content/sponsor-campaign-events/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-campaigns.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/admin/sponsor-campaigns/page.tsx', import.meta.url), 'utf8'),
]);

function functionBody(name, nextMarker) {
  const start = bootstrap.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = bootstrap.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `Missing end marker after ${name}`);
  return bootstrap.slice(start, end);
}

test('campaign inventory is private and supports bounded, weighted delivery', () => {
  assert.match(bootstrap, /CREATE TABLE public\.sponsor_campaigns/);
  assert.match(bootstrap, /ALTER TABLE public\.sponsor_campaigns ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE public\.sponsor_campaigns FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /CREATE TABLE catho_private\.sponsor_campaign_events/);
  assert.match(bootstrap, /CREATE TABLE catho_private\.sponsor_campaign_daily/);
  assert.match(bootstrap, /CREATE TABLE catho_private\.sponsor_campaign_user_frequency/);
  assert.match(bootstrap, /sponsor_campaign_events_one_viewable_per_session_idx/);
  assert.match(bootstrap, /sponsor_campaign_events_one_click_per_session_idx/);
  assert.match(bootstrap, /cathoscroll-prune-sponsor-campaign-events/);
});

test('weighted campaign selector enforces payment, dates, targeting, caps and concurrency', () => {
  const selector = functionBody(
    'public.get_weighted_sponsor_campaigns',
    'ALTER FUNCTION public.get_weighted_sponsor_campaigns'
  );
  assert.match(selector, /sponsor\.payment_status IN \('received', 'not_required'\)/);
  assert.match(selector, /campaign\.starts_on <= v_today AND campaign\.ends_on >= v_today/);
  assert.match(selector, /target_category_slugs/);
  assert.match(selector, /target_topic_ids/);
  assert.match(selector, /daily_impression_cap/);
  assert.match(selector, /total_impression_cap/);
  assert.match(selector, /frequency_cap_per_user_24h/);
  assert.match(selector, /frequency_cap_per_user_total/);
  assert.match(selector, /pg_advisory_xact_lock/);
  assert.match(selector, /FOR UPDATE OF campaign SKIP LOCKED/);
  assert.match(selector, /campaign\.placement_weight/);
});

test('sponsor event recording requires a served and viewable placement', () => {
  const recorder = functionBody(
    'public.record_sponsor_campaign_event',
    'ALTER FUNCTION public.record_sponsor_campaign_event'
  );
  assert.match(recorder, /event_type='served'/);
  assert.match(recorder, /event_type='viewable_impression'/);
  assert.match(recorder, /ON CONFLICT DO NOTHING/);
  assert.match(recorder, /sponsor_campaign_daily/);
  assert.match(eventRoute, /getAuthenticatedUserFromRequest/);
  assert.match(eventRoute, /isSameOriginOrNativeRequest/);
  assert.match(eventRoute, /checkApiRateLimit/);
});

test('sponsored feed cards are disclosed and inserted separately from organic recommendations', () => {
  assert.match(campaignLib, /SPONSOR_CARD_CADENCE = 10/);
  assert.match(feedCore, /shouldInsertSponsorCard/);
  assert.match(feedCore, /lastInterstitialType/);
  assert.match(feedCore, /SponsorFeedCard/);
  assert.match(sponsorCard, /Sponsored/);
  assert.match(sponsorCard, /viewable_impression/);
  assert.match(sponsorCard, /IntersectionObserver/);
  assert.match(sponsorCard, /1000/);
  assert.match(sponsorCard, /target="_blank"/);
  assert.match(feedCore, /Give each sponsor-card placement its own ID/);
  assert.match(feedCore, /sessionId: string/);
  assert.match(deliveryRoute, /getAuthenticatedUserFromRequest/);
  assert.match(deliveryRoute, /isSameOriginOrNativeRequest/);
  assert.match(deliveryRoute, /get_weighted_sponsor_campaigns/);
  assert.match(deliveryRoute, /data\.campaigns\.length > 5/);
});

test('campaign admin controls require bank reconciliation before approval', () => {
  assert.match(campaignManager, /Create campaign/);
  assert.match(campaignManager, /placementWeight/);
  assert.match(campaignManager, /frequencyCapPerUser24h/);
  assert.match(campaignManager, /Approve/);
  assert.match(campaignManager, /eligibleForApproval/);
  assert.match(campaignManager, /payment_status/);
  assert.match(bootstrap, /Campaign requires an active sponsor and reconciled payment before approval/);
});

test('administrator campaign reporting reads aggregate-only daily metrics', () => {
  const analytics = functionBody(
    'public.get_admin_sponsor_campaign_analytics',
    'ALTER FUNCTION public.get_admin_sponsor_campaign_analytics'
  );
  assert.match(analytics, /admin_users/);
  assert.match(analytics, /p_to - p_from > 179/);
  assert.match(analytics, /sponsor_campaign_daily/);
  assert.match(analytics, /viewable_impressions/);
  assert.match(analytics, /click_through_rate/);
  assert.doesNotMatch(analytics, /'user_id'|'session_id'/);
  assert.match(campaignPage, /get_admin_sponsor_campaign_analytics/);
  assert.match(campaignManager, /Performance \(30 days\)/);
});

test('top-comment selection and sponsor retention work remain bounded', () => {
  const topComments = functionBody(
    'public.get_top_feed_comments',
    'COMMENT ON FUNCTION public.get_top_feed_comments'
  );
  assert.match(topComments, /candidate_ids AS MATERIALIZED/);
  assert.match(topComments, /LIMIT 5000/);
  assert.match(topComments, /created_at DESC, candidate.id DESC/);

  const prune = functionBody(
    'catho_private.prune_sponsor_campaign_events',
    'REVOKE ALL ON FUNCTION catho_private.prune_sponsor_campaign_events'
  );
  assert.match(prune, /SET status = 'completed'/);
  assert.match(prune, /campaign.ends_on < \(p_before AT TIME ZONE 'UTC'\)::date/);
  assert.match(bootstrap, /NOTIFY pgrst, 'reload schema';\s*-- End of CathoScroll application-schema and catalogue bootstrap\./);
});
