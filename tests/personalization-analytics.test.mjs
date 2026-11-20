import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8');
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
    const closingTag = source.indexOf(tag, bodyStart);
    assert.notEqual(closingTag, -1, 'Missing function terminator: ' + match[1]);
    const end = closingTag + tag.length;
    assert.equal(source[end], ';', 'Missing SQL statement terminator: ' + match[1]);
    return { name: match[1], start: match.index, end: end + 1 };
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
  assert.equal(functionStarts.length, 111);
  assert.equal(new Set(functionStarts.map((match) => match[1].toLowerCase())).size, 107);
  assert.equal((bootstrap.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+[a-z0-9_]+\.[a-z0-9_]+\s*\(/gi) ?? []).length, 52);
  assert.equal((bootstrap.match(/CREATE POLICY /g) ?? []).length, 32);
  assert.equal((bootstrap.match(/CREATE TRIGGER /g) ?? []).length, 34);
  assert.equal((bootstrap.match(/CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? /g) ?? []).length, 94);
  const functionRanges = bootstrapFunctionRanges(bootstrap);
  assert.equal(functionRanges.length, 111);
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

test('profile scoring separates short and long horizons and suppresses one-session skips', () => {
  const body = functionBody('catho_private.refresh_user_interest_profile');
  assert.match(body, /interval '14 days'/);
  assert.match(body, /interval '90 days'/);
  assert.match(body, /interval '180 days'/);
  assert.match(body, /coalesce\(ss\.skip_sessions,0\)>=2/);
  assert.match(body, /explicit_score/);
  assert.match(body, /inferred_score/);
  assert.match(body, /v_consent_at/);
  assert.match(body, /greatest\(v_now-interval '90 days',v_consent_at\)/);
  assert.match(body, /s\.updated_at < v_now/);
  assert.match(body, /v_last_refresh >= v_now-interval '5 minutes'/);
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
  assert.match(settings, /This setting is not a declaration of religious affiliation/);
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

test('profile scoring separates short and long horizons and suppresses one-session skips', () => {
  const body = functionBody('catho_private.refresh_user_interest_profile');
  assert.match(body, /interval '14 days'/);
  assert.match(body, /interval '90 days'/);
  assert.match(body, /interval '180 days'/);
  assert.match(body, /coalesce\(ss\.skip_sessions,0\)>=2/);
  assert.match(body, /explicit_score/);
  assert.match(body, /inferred_score/);
  assert.match(body, /v_consent_at/);
  assert.match(body, /greatest\(v_now-interval '90 days',v_consent_at\)/);
  assert.match(body, /s\.updated_at < v_now/);
  assert.match(body, /v_last_refresh >= v_now-interval '5 minutes'/);
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
  assert.match(settings, /This setting is not a declaration of religious affiliation/);
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
