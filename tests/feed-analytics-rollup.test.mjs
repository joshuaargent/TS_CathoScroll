import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bootstrap = await readFile(
  new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url),
  'utf8'
);

function functionBody(name, nextMarker) {
  const start = bootstrap.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = bootstrap.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `Missing end marker after ${name}`);
  return bootstrap.slice(start, end);
}

test('daily feed analytics aggregates contain no user or session identifiers', () => {
  const start = bootstrap.indexOf('CREATE TABLE catho_private.feed_analytics_daily (');
  const end = bootstrap.indexOf(');', start);
  assert.notEqual(start, -1);
  const table = bootstrap.slice(start, end);
  assert.match(table, /PRIMARY KEY \(event_date, entity_id\)/);
  assert.doesNotMatch(table, /user_id|session_id|metadata/i);
  assert.match(bootstrap, /CREATE TABLE catho_private\.feed_analytics_daily_viewers/);
  assert.match(bootstrap, /ALTER TABLE catho_private\.feed_analytics_daily ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /ALTER TABLE catho_private\.feed_analytics_daily_viewers ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE catho_private\.feed_analytics_daily FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE catho_private\.feed_analytics_daily_viewers FROM PUBLIC, anon, authenticated, service_role/);
});

test('daily rollup refresh is bounded, UTC-based and safe to retry', () => {
  const refresh = functionBody(
    'catho_private.refresh_feed_analytics_daily',
    'ALTER FUNCTION catho_private.refresh_feed_analytics_daily'
  );
  assert.match(refresh, /p_days_back < 0 OR p_days_back > 7/);
  assert.match(refresh, /timezone\('UTC'/);
  assert.match(refresh, /ON CONFLICT \(event_date, entity_id\) DO UPDATE/);
  assert.match(refresh, /DELETE FROM catho_private\.feed_analytics_daily_viewers/);
  assert.match(refresh, /SELECT DISTINCT[\s\S]*event\.user_id/);
});

test('admin analytics uses daily rollups for totals and series, retaining raw session-depth calculation', () => {
  const analytics = functionBody(
    'public.get_admin_content_analytics',
    'ALTER FUNCTION public.get_admin_content_analytics'
  );
  assert.match(analytics, /FROM catho_private\.feed_analytics_daily AS daily/);
  assert.match(analytics, /FROM catho_private\.feed_analytics_daily_viewers AS daily_viewer/);
  assert.match(analytics, /FROM catho_private\.feed_analytics_events AS raw_event/);
  assert.match(analytics, /average_slide_depth/);
  assert.match(analytics, /aggregate\.event_date >= v_rollup_from/);
});

test('raw events and user/day viewer bridge have bounded retention jobs', () => {
  const prune = functionBody(
    'catho_private.prune_feed_analytics_events',
    '-- DDL event triggers'
  );
  assert.match(prune, /p_limit < 1 OR p_limit > 10000/);
  assert.match(prune, /LIMIT p_limit/);
  assert.match(prune, /expired_viewers/);
  assert.match(bootstrap, /cathoscroll-rollup-feed-analytics', '\*\/5 \* \* \* \*'/);
  assert.match(bootstrap, /cathoscroll-prune-feed-analytics', '\*\/15 \* \* \* \*'/);
  assert.match(bootstrap, /refresh_feed_analytics_daily\(2\)/);
  assert.match(bootstrap, /interval ''180 days'', 5000/);
});
