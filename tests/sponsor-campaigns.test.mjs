import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [bootstrap, feedCore, cardRegistry, placementRegistry, sponsorCard, campaignManager, campaignAdminRoute, deliveryRoute, eventRoute, campaignLib, campaignPage] = await Promise.all([
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/feed-card-registry.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-card-placement-registry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/SponsorCampaignManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsor-campaigns/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/content/sponsored-campaigns/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/content/sponsor-campaign-events/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/sponsor-campaigns.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/admin/sponsor-campaigns/page.tsx', import.meta.url), 'utf8'),
]);

function functionBody(name) {
  const start = bootstrap.lastIndexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = bootstrap.indexOf('$function$;', start);
  assert.notEqual(end, -1, `Missing function terminator after ${name}`);
  return bootstrap.slice(start, end + '$function$;'.length);
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
  assert.match(selector, /sponsor\.status IN/);
  assert.match(selector, /scheduled/);
  assert.match(selector, /sponsor\.starts_on IS NULL/);
  assert.match(selector, /sponsor\.ends_on IS NULL/);
  assert.match(selector, /sponsor\.payment_status IN \('received', 'not_required'\)/);
  assert.match(selector, /campaign\.starts_on <= v_today AND campaign\.ends_on >= v_today/);
  assert.match(selector, /target_category_slugs/);
  assert.match(selector, /target_topic_ids/);
  assert.match(selector, /daily_impression_cap/);
  assert.match(selector, /total_impression_cap/);
  assert.match(selector, /frequency_cap_per_user_24h/);
  assert.match(selector, /recent_viewable\.event_type = 'viewable_impression'/);
  assert.doesNotMatch(selector, /recent_served\.event_type = 'served'/);
  assert.match(selector, /recent_viewable\.event_type = 'viewable_impression'/);
  assert.doesNotMatch(selector, /recent_served\.event_type = 'served'/);
  assert.match(selector, /frequency_cap_per_user_total/);
  assert.match(selector, /pg_advisory_xact_lock/);
  assert.match(selector, /FOR UPDATE OF campaign SKIP LOCKED/);
  assert.match(selector, /campaign\.placement_weight/);
  assert.match(selector, /daily\.viewable_impressions/);
  assert.match(selector, /daily\.event_date >= v_today - 29/);
  assert.match(selector, /viewable_impressions[\s\S]*placement_weight::numeric ASC/);
  assert.match(selector, /p_limit > 1/);
  assert.doesNotMatch(selector, /ORDER BY -pg_catalog\.ln\(greatest\(pg_catalog\.random/);
});

test('signed-in and anonymous selectors derive category from the published topic and share campaign caps', () => {
  const signedIn = functionBody('public.get_weighted_sponsor_campaigns');
  const anonymous = functionBody('public.get_anonymous_sponsor_campaigns');
  assert.ok(signedIn.endsWith('$function$;'));
  assert.ok(anonymous.endsWith('$function$;'));
  for (const selector of [signedIn, anonymous]) {
    assert.match(selector, /SELECT (?:topic|t)\.category_slug INTO v_topic_category_slug/);
    assert.match(selector, /v_topic_category_slug = ANY\(campaign\.target_category_slugs\)|v_topic_category_slug=ANY\(campaign\.target_category_slugs\)/);
    assert.match(selector, /public\.topics/);
    assert.match(selector, /is_published/);
    assert.match(selector, /p_topic_id IS NULL/);
    assert.doesNotMatch(selector, /p_category_slug\s*(?:=|=ANY)/);
    assert.match(selector, /anonymous_sponsor_campaign_daily/);
  }
  assert.match(signedIn, /campaign\.served_count \+ coalesce/);
  assert.match(signedIn, /campaign\.daily_impression_cap/);
  assert.match(signedIn, /FROM catho_private\.anonymous_sponsor_campaign_daily AS daily[\s\S]*?campaign\.daily_impression_cap/);
  assert.match(signedIn, /FROM catho_private\.anonymous_sponsor_campaign_daily AS daily[\s\S]*?campaign\.total_impression_cap/);
  assert.match(signedIn, /FROM catho_private\.anonymous_sponsor_campaign_daily AS daily[\s\S]*?placement_weight::numeric ASC/);
  assert.match(anonymous, /FROM catho_private\.sponsor_campaign_daily d[\s\S]*?campaign\.daily_impression_cap/);
  assert.match(anonymous, /IF p_session_token IS NOT NULL THEN[\s\S]*?INSERT INTO catho_private\.anonymous_sponsor_events/);
  assert.match(anonymous, /IF p_session_token IS NULL THEN true ELSE/);
  assert.match(anonymous, /INSERT INTO catho_private\.anonymous_sponsor_campaign_daily/);
  assert.match(anonymous, /FROM catho_private\.sponsor_campaign_daily d[\s\S]*?placement_weight/);
  assert.match(signedIn, /placement_weight::numeric ASC/);
  assert.match(signedIn, /v_session_id := CASE WHEN coalesce\(v_sponsor_measurement, false\) THEN p_session_id ELSE NULL END/);
  assert.match(signedIn, /IF v_session_id IS NOT NULL THEN[\s\S]*?INSERT INTO catho_private\.sponsor_campaign_events/);
  assert.match(signedIn, /INSERT INTO catho_private\.sponsor_campaign_daily/);
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
  assert.match(deliveryRoute, /if \(!headers\.has\('Access-Control-Allow-Origin'\)\)/);
  assert.match(eventRoute, /if \(!headers\.has\('Access-Control-Allow-Origin'\)\)/);
  assert.doesNotMatch(deliveryRoute, /&& !headers\.has\('Vary'\)/);
  assert.doesNotMatch(eventRoute, /&& !headers\.has\('Vary'\)/);
  assert.match(deliveryRoute, /if \(!headers\.has\('Access-Control-Allow-Origin'\)\)/);
  assert.match(eventRoute, /if \(!headers\.has\('Access-Control-Allow-Origin'\)\)/);
  assert.doesNotMatch(deliveryRoute, /&& !headers\.has\('Vary'\)/);
  assert.doesNotMatch(eventRoute, /&& !headers\.has\('Vary'\)/);
  assert.match(eventRoute, /checkApiRateLimit/);
});

test('sponsored feed cards are disclosed and inserted separately from organic recommendations', () => {
  assert.match(campaignLib, /SPONSOR_CARD_CADENCE = 10/);
  assert.match(feedCore, /buildFeedEntryMap/);
  assert.match(placementRegistry, /id: DEFAULT_FEED_CARD_RULES\.sponsor\.id/);
  assert.match(placementRegistry, /interval: sponsorInterval/);
  assert.match(feedCore, /prefetchMappedSponsor/);
  assert.match(feedCore, /Keep the placement in the feed and expose an explicit retry action/);
  assert.match(cardRegistry, /error=\{entry\.status === 'error'\}/);
  assert.match(cardRegistry, /onRetry=\{\(\) => context\.retrySponsorEntry\(entry\)\}/);
  assert.doesNotMatch(feedCore, /lastInterstitialType/);
  assert.match(feedCore, /const nextSponsorBoundary = boundaries/);
  assert.match(feedCore, /sponsorCadenceAfter/);
  assert.match(cardRegistry, /SponsorFeedCard/);
  assert.match(sponsorCard, /Sponsored/);
  assert.match(sponsorCard, /viewable_impression/);
  assert.match(sponsorCard, /IntersectionObserver/);
  assert.match(sponsorCard, /1000/);
  assert.match(sponsorCard, /target="_blank"/);
  assert.match(sponsorCard, /<DoorOpen/);
  assert.match(sponsorCard, /<Share2/);
  assert.match(sponsorCard, /navigator\.share/);
  assert.match(sponsorCard, /navigator\.clipboard\.writeText\(campaign\.destination_url\)/);
  assert.match(sponsorCard, /title: campaign\.headline,[\s\S]*url: campaign\.destination_url/);
  assert.match(sponsorCard, /Visit \{campaign\.sponsor_name\}/);
  assert.doesNotMatch(sponsorCard, /campaign\.image_url/);
  assert.doesNotMatch(sponsorCard, /shareStatus/);
  assert.match(sponsorCard, /onDoubleClick=/);
  assert.doesNotMatch(sponsorCard, /campaign\.cta_label\}\s*<ExternalLink/);
  assert.doesNotMatch(sponsorCard, /bg-accent text-white hover:bg-accent\/90/);
  assert.match(feedCore, /Anonymous placements share an in-memory session token for frequency caps/);
  assert.match(feedCore, /const measurementEnabled = hasAnalyticsConsent\('sponsorMeasurement', userId\)/);
  assert.match(feedCore, /const sessionId = measurementEnabled[\s\S]*?createSponsorPlacementId\(\)[\s\S]*?createSponsorSessionId\(\)[\s\S]*?: null/);
  assert.match(feedCore, /sessionId: string \| null/);
  assert.match(deliveryRoute, /getAuthenticatedUserFromRequest/);
  assert.match(deliveryRoute, /isSameOriginOrNativeRequest/);
  assert.match(deliveryRoute, /get_weighted_sponsor_campaigns/);
  assert.match(deliveryRoute, /p_limit: 1/);
  assert.match(deliveryRoute, /data\.campaigns\.length > 1/);
});

test('campaign admin controls require bank reconciliation before approval and support the 25-impression test cap', () => {
  assert.match(bootstrap, /frequency_cap_per_user_24h integer NOT NULL DEFAULT 1 CHECK \(frequency_cap_per_user_24h BETWEEN 1 AND 25\)/);
  for (const name of ['public.admin_create_sponsor_campaign', 'public.sponsor_create_campaign', 'public.sponsor_update_campaign']) {
    const body = functionBody(name, `ALTER FUNCTION ${name}`);
    assert.match(body, /p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 25/);
  }
  assert.match(campaignManager, /Create campaign/);
  assert.match(campaignManager, /placementWeight/);
  assert.match(campaignManager, /frequencyCapPerUser24h/);
  assert.match(campaignManager, /name="frequencyCapPerUser24h" type="number" min="1" max="25"/);
  assert.match(campaignAdminRoute, /positiveInteger\(body\.frequencyCapPerUser24h, 25\)/);
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
  assert.match(analytics, /p_to-p_from>179/);
  assert.match(analytics, /sponsor_campaign_daily/);
  assert.match(analytics, /viewable_impressions/);
  assert.match(analytics, /click_through_rate/);
  assert.doesNotMatch(analytics, /'user_id'|'session_id'/);
  assert.match(campaignPage, /get_admin_sponsor_campaign_analytics/);
  assert.match(campaignManager, /Performance \(30 days\)/);
});

test('top-comment selection and sponsor retention work remain bounded', () => {
  const topCommentsStart = bootstrap.indexOf('CREATE OR REPLACE FUNCTION public.get_top_feed_comments(');
  const topCommentsEnd = bootstrap.indexOf('COMMENT ON FUNCTION public.get_top_feed_comments(integer, integer)', topCommentsStart);
  assert.ok(topCommentsStart >= 0 && topCommentsEnd > topCommentsStart);
  const topComments = bootstrap.slice(topCommentsStart, topCommentsEnd);
  assert.match(topComments, /p_offset integer DEFAULT 0/);
  assert.match(topComments, /p_limit integer DEFAULT 100/);
  assert.match(topComments, /LIMIT p_limit OFFSET p_offset/);
  assert.match(topComments, /'next_offset'/);
  assert.match(topComments, /candidate_ids AS MATERIALIZED/);
  assert.match(topComments, /LIMIT 5000/);
  assert.match(topComments, /created_at DESC, candidate.id DESC/);

  const prune = functionBody(
    'catho_private.prune_sponsor_campaign_events',
    'REVOKE ALL ON FUNCTION catho_private.prune_sponsor_campaign_events'
  );
  assert.match(prune, /SET status = 'completed'/);
  assert.match(prune, /campaign.ends_on < \(p_before AT TIME ZONE 'UTC'\)::date/);
  assert.match(bootstrap, /prune_sponsor_campaign_events\(statement_timestamp\(\) - interval ''180 days'', 5000\)/);
  assert.doesNotMatch(bootstrap, /prune_sponsor_campaign_events\(clock_timestamp\(\)/);
  assert.match(bootstrap, /NOTIFY pgrst, 'reload schema';\s*-- End of CathoScroll application-schema and catalogue bootstrap\./);
});
