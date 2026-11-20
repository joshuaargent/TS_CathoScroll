import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8');
const upgrade = readFileSync(new URL('../docs/personalization-analytics-upgrade.sql', import.meta.url), 'utf8');
const documentation = readFileSync(new URL('../docs/personalization-analytics-implementation.md', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/account/PersonalizationAccountSection.tsx', import.meta.url), 'utf8');
const deepDive = readFileSync(new URL('../src/components/admin/AnalyticsDeepDivePanel.tsx', import.meta.url), 'utf8');
const signupForm = readFileSync(new URL('../src/components/auth/SignupFormView.tsx', import.meta.url), 'utf8');
const webSignup = readFileSync(new URL('../src/app/signup/page.tsx', import.meta.url), 'utf8');
const nativeSignup = readFileSync(new URL('../native/signup.tsx', import.meta.url), 'utf8');
const accountView = readFileSync(new URL('../src/components/account/AccountPageView.tsx', import.meta.url), 'utf8');
const accountSection = readFileSync(new URL('../src/components/account/PersonalizationAccountSection.tsx', import.meta.url), 'utf8');
const nativeMain = readFileSync(new URL('../native/main.tsx', import.meta.url), 'utf8');
const nativeAccount = readFileSync(new URL('../native/account.tsx', import.meta.url), 'utf8');


function bootstrapFunctionRanges(source) {
  const starts = [...source.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z0-9_]+\.[a-z0-9_]+)\s*\(/gi)];
  return starts.map((match) => {
    let cursor = match.index + match[0].length;
    let depth = 1;
    let inSingleQuote = false;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor];
      if (character === "'" && !inSingleQuote) inSingleQuote = true;
      else if (character === "'" && inSingleQuote && source[cursor + 1] === "'") cursor += 1;
      else if (character === "'" && inSingleQuote) inSingleQuote = false;
      else if (!inSingleQuote && character === '(') depth += 1;
      else if (!inSingleQuote && character === ')') depth -= 1;
    }
    assert.equal(depth, 0, 'Unbalanced function arguments: ' + match[1]);
    const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(source.slice(cursor, cursor + 2000));
    assert.ok(asMatch, 'Missing function body delimiter: ' + match[1]);
    const tag = asMatch[1];
    const bodyStart = cursor + asMatch.index + asMatch[0].length;
    const escapedTag = tag.replaceAll('$', '\\$');
    const closingPattern = new RegExp(escapedTag + '\\s*;', 'g');
    closingPattern.lastIndex = bodyStart;
    const terminator = closingPattern.exec(source);
    assert.ok(terminator, 'Missing function terminator: ' + match[1]);
    const end = terminator.index + terminator[0].length;
    return { name: match[1], start: match.index, end };
  });
}

function functionBody(name) {
  const start = bootstrap.lastIndexOf('CREATE OR REPLACE FUNCTION ' + name);
  assert.notEqual(start, -1, 'missing SQL function: ' + name);
  const end = bootstrap.indexOf('$function$;', start);
  assert.notEqual(end, -1, 'unterminated SQL function: ' + name);
  return bootstrap.slice(start, end + '$function$;'.length);
}


test('emergency bootstrap inventory matches the reconciled production schema', () => {
  const functionStarts = [...bootstrap.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+([a-z0-9_]+\.[a-z0-9_]+)\s*\(/gi)];
  assert.ok(functionStarts.length >= 110, 'The bootstrap must retain the reconciled database function inventory');
  assert.ok(new Set(functionStarts.map((match) => match[1].toLowerCase())).size >= 106);
  assert.ok((bootstrap.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+[a-z0-9_]+\.[a-z0-9_]+\s*\(/gi) ?? []).length >= 53);
  assert.ok((bootstrap.match(/CREATE POLICY /g) ?? []).length >= 32);
  assert.ok((bootstrap.match(/CREATE TRIGGER /g) ?? []).length >= 34);
  assert.ok((bootstrap.match(/CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? /g) ?? []).length >= 95);
  const functionRanges = bootstrapFunctionRanges(bootstrap);
  assert.equal(functionRanges.length, (bootstrap.match(/CREATE OR REPLACE FUNCTION\s+[a-z0-9_]+\.[a-z0-9_]+\s*\(/gi) ?? []).length);
  for (let index = 0; index < functionRanges.length - 1; index += 1) {
    assert.ok(functionRanges[index].end <= functionRanges[index + 1].start, 'Function body overlaps the next SQL definition: ' + functionRanges[index].name);
  }
  assert.equal((bootstrap.match(/CREATE EVENT TRIGGER ensure_rls/g) ?? []).length, 1);
  assert.equal(bootstrap.split('DO $cron_restore$').length - 1, 1);
  const eventTriggerPosition = bootstrap.indexOf('CREATE EVENT TRIGGER ensure_rls');
  const retentionPosition = bootstrap.indexOf('DO $cron_restore$');
  assert.ok(!functionRanges.some((range) => eventTriggerPosition >= range.start && eventTriggerPosition < range.end));
  assert.ok(!functionRanges.some((range) => retentionPosition >= range.start && retentionPosition < range.end));
  assert.doesNotMatch(bootstrap, /subscription_tier|get_own_subscription_tier/);
  assert.match(bootstrap, /public\.get_admin_feed_analytics/);
  assert.match(bootstrap, /public\.get_admin_sponsor_analytics/);
  assert.match(bootstrap, /public\.admin_create_sponsor/);
});

test('personalisation consent is opt-in and versioned', () => {
  assert.match(bootstrap, /user_personalization_consents[\s\S]*enabled boolean NOT NULL DEFAULT false/);
  assert.match(bootstrap, /consent_version/);
  assert.match(settings, /This is optional and off until you enable it/);
  assert.match(settings, /activity recorded after you opt in/);
  assert.match(bootstrap, /capture_signup_personalization_consent/);
  assert.match(bootstrap, /NEW\.raw_user_meta_data ->> 'personalization_consent' = 'true'/);
  assert.match(bootstrap, /AFTER INSERT ON auth\.users/);
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

test('recommendation profiles use explicit account actions and never read operational analytics', () => {
  const body = functionBody('catho_private.refresh_user_interest_profile');
  assert.doesNotMatch(body, /feed_analytics_events|feed_card_analytics_events|viewable_impression|active_duration|swipe_depth|return_visit|skip_sessions/);
  assert.match(body, /FROM public\.progress/);
  assert.match(body, /FROM public\.bookmarks/);
  assert.match(body, /FROM public\.topic_likes/);
  assert.match(body, /FROM public\.comments/);
  assert.match(body, /FROM public\.comment_likes/);
  assert.match(body, /interval '14 days'/);
  assert.match(body, /interval '180 days'/);
  assert.match(body, /7776000/);
  assert.match(body, /0::numeric AS inferred_score/);
  assert.match(body, /0::numeric AS negative_score/);
  assert.match(body, /v_consent_at/);
  assert.match(body, /explicit-only/);
  assert.match(body, /s\.updated_at < v_now/);
  assert.match(body, /v_last_refresh >= v_now-interval '5 minutes'/);
  const upgradeStart = upgrade.lastIndexOf('CREATE OR REPLACE FUNCTION catho_private.refresh_user_interest_profile');
  const upgradeEnd = upgrade.indexOf('$function$;', upgradeStart);
  assert.ok(upgradeStart >= 0 && upgradeEnd > upgradeStart);
  assert.doesNotMatch(upgrade.slice(upgradeStart, upgradeEnd), /feed_analytics_events|feed_card_analytics_events/);
});

test('authoritative bootstrap and existing personalization upgrade keep profile and cursor functions in sync', () => {
  const names = [
    'catho_private.refresh_user_interest_profile',
    'catho_private.get_user_recommendation_category_weights',
    'public.get_my_recommendation_page',
  ];
  for (const name of names) {
    const bootstrapFunction = functionBody(name);
    const upgradeStart = upgrade.lastIndexOf('CREATE OR REPLACE FUNCTION ' + name);
    const upgradeEnd = upgrade.indexOf('$function$;', upgradeStart);
    assert.ok(upgradeStart >= 0 && upgradeEnd > upgradeStart);
    assert.equal(bootstrapFunction, upgrade.slice(upgradeStart, upgradeEnd + '$function$;'.length));
  }
  assert.doesNotMatch(functionBody('catho_private.refresh_user_interest_profile'), /feed_analytics_events|feed_card_analytics_events/);
  assert.doesNotMatch(functionBody('catho_private.get_user_recommendation_category_weights'), /feed_analytics_events|feed_card_analytics_events/);
  assert.match(upgrade, /DELETE FROM catho_private\.user_topic_interest_scores/);
  assert.match(upgrade, /profile_refreshed_at = NULL/);
});

test('recommendation category helper is account-scoped, consent-gated and bounded', () => {
  const body = functionBody('catho_private.get_user_recommendation_category_weights');
  assert.match(body, /auth\.uid\(\)/);
  assert.match(body, /v_current_user_id IS DISTINCT FROM p_user_id/);
  assert.match(body, /c\.enabled = true/);
  assert.match(body, /greatest\(v_now - interval '180 days', v_consent_at\)/);
  assert.match(body, /get_user_feed_preference_signals/);
  assert.doesNotMatch(body, /feed_analytics_events|feed_card_analytics_events/);
});

test('active recommendation cursors rebase model weights without losing pagination positions', () => {
  const body = functionBody('public.get_my_recommendation_page');
  assert.match(body, /personalization_model_version constant text := 'explicit-actions-v3'/);
  assert.match(body, /state->>'personalizationModelVersion' IS DISTINCT FROM personalization_model_version/);
  assert.match(body, /get_user_recommendation_category_weights\(current_user_id\)/);
  assert.match(body, /coalesce\(\(existing\.entry->>'served'\)::integer, 0\)/);
  assert.match(body, /existing\.entry->'order'/);
  assert.match(body, /existing\.entry->'id'/);
  assert.match(body, /'last', last_category/);
  assert.match(body, /'streak', streak/);
  assert.match(body, /'personalizationModelVersion'/);
});

test('admin deep dive returns aggregate reports and correctly censors immature cohorts', () => {
  const body = functionBody('public.get_admin_analytics_deep_dive');
  assert.match(body, /'funnel'/);
  assert.match(body, /'sessions'/);
  assert.match(body, /'recommendations'/);
  assert.match(body, /feed_topics AS/);
  assert.match(body, /t\.entity_id=e\.entity_id/);
  assert.match(body, /'retention'/);
  assert.match(body, /IS DISTINCT FROM f\.first_session_id/);
  assert.match(body, /ELSE NULL END AS returned_7d/);
  assert.match(body, /ELSE NULL END AS returned_30d/);
  assert.match(deepDive, /not an A\/B test/);
  assert.match(documentation, /do not return user IDs, session IDs/);
});


test('admin deep-dive analytics is service-role only', () => {
  assert.match(bootstrap, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_deep_dive\(uuid, timestamp with time zone, timestamp with time zone\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION public\.get_admin_analytics_deep_dive\(uuid, timestamp with time zone, timestamp with time zone\) TO service_role/);
});

test('explicit category interests are bounded and validated', () => {
  const body = functionBody('public.set_my_personalization_interests');
  assert.match(body, /cardinality\(p_category_slugs\)>20/);
  assert.match(body, /Enable personalisation before saving interests/);
  assert.match(body, /is_published=true/);
});

test('personalisation settings disclose the profile purpose and sponsor isolation', () => {
  assert.match(settings, /not shown on your public profile or used for sponsor targeting/);
  assert.match(settings, /Turn off and delete profile/);
  assert.match(settings, /may reveal religious or philosophical beliefs/);
});

test('signup collects separate, unchecked explicit consent on web and native', () => {
  assert.match(signupForm, /name="personalizationConsent"/);
  assert.match(signupForm, /type="checkbox"/);
  assert.match(signupForm, /I explicitly consent to CathoScroll using my reading activity and chosen interests/);
  assert.doesNotMatch(signupForm, /name="personalizationConsent"[\s\S]{0,180}checked/);
  assert.match(webSignup, /personalization_consent: personalizationConsent/);
  assert.match(nativeSignup, /personalization_consent: personalizationConsent/);
});

test('all recommendation history signals are opt-in and withdrawal neutralises active cursors', () => {
  const body = functionBody('public.get_my_recommendation_page');
  assert.match(body, /SELECT coalesce\(enabled,false\) INTO personalization_enabled/);
  assert.match(body, /IF personalization_enabled THEN/);
  assert.match(body, /WITH signals AS/);
  assert.match(body, /ELSE[\s\S]*?SELECT coalesce/);
  assert.match(body, /include_completed := NOT personalization_enabled/);
  assert.match(body, /'includeCompleted', include_completed/);
  assert.match(body, /IF NOT personalization_enabled THEN/);
  assert.match(body, /'weight', 1/);
  assert.match(body, /include_completed := true/);
  assert.match(documentation, /All account-history recommendation weighting is consent-gated/);
});

test('web and native account/settings screens reuse the same components', () => {
  assert.match(accountView, /PersonalizationAccountSection/);
  assert.match(accountSection, /set_my_personalization_consent/);
  assert.match(accountSection, /I explicitly consent to CathoScroll using my topic-reading activity and selected interests/);
  assert.match(nativeMain, /pathname === '\/account\/personalization'.*kind: 'account'/);
  assert.match(nativeAccount, /AccountPageView/);
  assert.match(accountView, /PersonalizationAccountSection/);
});

test('retired user subscription tier is absent from the bootstrap', () => {
  assert.doesNotMatch(bootstrap, /subscription_tier|get_own_subscription_tier/);
});

test('existing-database upgrade contains feed-card analytics schema and secure ingestion RPC', () => {
  assert.match(upgrade, /CREATE TABLE IF NOT EXISTS catho_private\.feed_card_analytics_events/);
  assert.match(upgrade, /CREATE TABLE IF NOT EXISTS catho_private\.feed_card_analytics_event_limits/);
  assert.match(upgrade, /CREATE TABLE IF NOT EXISTS catho_private\.feed_card_analytics_daily/);
  assert.match(upgrade, /CREATE TABLE IF NOT EXISTS catho_private\.feed_card_analytics_daily_viewers/);
  const rpcStart = upgrade.indexOf('CREATE OR REPLACE FUNCTION public.record_feed_card_analytics_events');
  const rpcEnd = upgrade.indexOf('$function$;', rpcStart);
  assert.ok(rpcStart >= 0 && rpcEnd > rpcStart);
  assert.match(upgrade.slice(rpcStart, rpcEnd), /SECURITY DEFINER/);
  assert.match(upgrade, /GRANT EXECUTE ON FUNCTION public\.record_feed_card_analytics_events\(jsonb\) TO authenticated/);
});

test('recommendation upgrade reads only activity created after explicit consent and has secure RPC ACLs', () => {
  const start = upgrade.indexOf('CREATE OR REPLACE FUNCTION public.get_my_recommendation_page');
  const end = upgrade.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start);
  const body = upgrade.slice(start, end);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /p\.completed_at >= \(SELECT granted_at/);
  assert.match(body, /b\.created_at >= \(SELECT granted_at/);
  assert.match(body, /l\.created_at >= \(SELECT granted_at/);
  assert.match(body, /c\.created_at >= \(SELECT granted_at/);
  assert.match(upgrade, /REVOKE ALL ON FUNCTION public\.get_my_recommendation_page\(jsonb, integer\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(upgrade, /GRANT EXECUTE ON FUNCTION public\.get_my_recommendation_page\(jsonb, integer\) TO authenticated, service_role/);
  const bootstrapStart = bootstrap.indexOf('CREATE OR REPLACE FUNCTION public.get_my_recommendation_page');
  const bootstrapEnd = bootstrap.indexOf('$function$;', bootstrapStart);
  const bootstrapBody = bootstrap.slice(bootstrapStart, bootstrapEnd);
  assert.match(bootstrapBody, /p\.completed_at >= \(SELECT granted_at/);
  assert.match(bootstrapBody, /b\.created_at >= \(SELECT granted_at/);
  assert.match(bootstrapBody, /l\.created_at >= \(SELECT granted_at/);
  assert.match(bootstrapBody, /c\.created_at >= \(SELECT granted_at/);
});


test('analytics database scripts keep function grants after definitions and schedule maintenance', () => {
  const pruneDefinition = bootstrap.indexOf('CREATE OR REPLACE FUNCTION catho_private.prune_anonymous_analytics()');
  const pruneGrant = bootstrap.indexOf('REVOKE ALL ON FUNCTION catho_private.prune_anonymous_analytics()');
  assert.ok(pruneDefinition >= 0 && pruneGrant > pruneDefinition);
  assert.doesNotMatch(bootstrap, /^\), placement_id text/m);
  assert.match(upgrade, /cathoscroll-rollup-feed-card-analytics/);
  assert.match(upgrade, /cathoscroll-prune-feed-card-analytics/);
});
