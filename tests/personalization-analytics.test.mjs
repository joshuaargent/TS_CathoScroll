import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8');
const documentation = readFileSync(new URL('../docs/personalization-analytics-implementation.md', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/app/account/personalization/page.tsx', import.meta.url), 'utf8');
const deepDive = readFileSync(new URL('../src/components/admin/AnalyticsDeepDivePanel.tsx', import.meta.url), 'utf8');

function functionBody(name) {
  const start = bootstrap.indexOf('CREATE OR REPLACE FUNCTION ' + name);
  assert.notEqual(start, -1, 'missing SQL function: ' + name);
  const end = bootstrap.indexOf('$function$;', start);
  assert.notEqual(end, -1, 'unterminated SQL function: ' + name);
  return bootstrap.slice(start, end + '$function$;'.length);
}

test('personalisation consent is opt-in and versioned', () => {
  assert.match(bootstrap, /user_personalization_consents[\s\S]*enabled boolean NOT NULL DEFAULT false/);
  assert.match(bootstrap, /consent_version/);
  assert.match(settings, /This is optional and off until you enable it/);
});

test('withdrawal deletes both inferred and explicitly selected interests', () => {
  const body = functionBody('public.set_my_personalization_consent');
  assert.match(body, /DELETE FROM catho_private\.user_topic_interest_scores WHERE user_id=v_user_id/);
  assert.match(body, /DELETE FROM catho_private\.user_explicit_category_interests WHERE user_id=v_user_id/);
  assert.match(body, /withdrawn_at=EXCLUDED\.withdrawn_at/);
});

test('recommendation profile signals are gated by consent', () => {
  const body = functionBody('catho_private.get_user_feed_preference_signals');
  assert.match(body, /user_personalization_consents[\s\S]*enabled=true[\s\S]*THEN RETURN/);
  assert.match(body, /refresh_user_interest_profile/);
  assert.match(body, /user_explicit_category_interests/);
});

test('profile scoring separates short and long horizons and suppresses one-session skips', () => {
  const body = functionBody('catho_private.refresh_user_interest_profile');
  assert.match(body, /interval '14 days'/);
  assert.match(body, /interval '90 days'/);
  assert.match(body, /interval '180 days'/);
  assert.match(body, /coalesce\(ss\.skip_sessions,0\)>=2/);
  assert.match(body, /explicit_score/);
  assert.match(body, /inferred_score/);
});

test('admin deep dive returns aggregate reports and correctly censors immature cohorts', () => {
  const body = functionBody('public.get_admin_analytics_deep_dive');
  assert.match(body, /'funnel'/);
  assert.match(body, /'sessions'/);
  assert.match(body, /'recommendations'/);
  assert.match(body, /'retention'/);
  assert.match(body, /ELSE NULL END AS returned_7d/);
  assert.match(body, /ELSE NULL END AS returned_30d/);
  assert.match(deepDive, /not an A\/B test/);
  assert.match(documentation, /do not return user IDs, session IDs/);
});

test('personalisation settings disclose the profile purpose and sponsor isolation', () => {
  assert.match(settings, /not used for sponsor targeting/);
  assert.match(settings, /Turn off and delete profile/);
  assert.match(settings, /This setting is not a declaration of religious affiliation/);
});
