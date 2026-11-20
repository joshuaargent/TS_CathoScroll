# Personalisation and analytics implementation

## Scope

This upgrade adds an optional, account-controlled recommendation-interest profile and extends the administrator analytics hub with feed quality, session, recommendation-outcome, category-discovery and cohort-retention reporting.

The existing measurement streams remain separate:

- Topic feed telemetry stays in `catho_private.feed_analytics_events` and its daily aggregates.
- Top Comments exposure stays in `catho_private.feed_card_analytics_events` and its daily aggregates.
- Paid sponsor served, viewable and click events stay in the sponsor campaign pipeline.
- Existing likes, bookmarks, progress, comments, comment likes and replies remain in their original interaction tables.

Sponsor delivery signals are never added to organic topic recommendation weights.

**Production rollout status:** the currently deployed production profile refresher still reads `feed_analytics_events` and `feed_card_analytics_events` when recommendation personalisation is enabled. PR26 replaces that dependency with explicit-action-only profile inputs and versioned cursor rebasing. Until the SQL upgrade is applied to production, do not describe the two data flows as fully separated.

## Personalisation privacy model

Personalisation is **off by default**. The account owner must explicitly opt in using the separate signup checkbox or Account → Personalisation. The consent record is versioned and belongs to the authenticated account. Signup consent is captured by an `auth.users` insert trigger from the one-time signup metadata value; subsequent user-metadata edits do not re-enable it. The browser cannot read or write the private profile tables directly.

When enabled, the private topic-interest profile is recomputed only from explicit account actions recorded after the user grants recommendation consent. Operational analytics events are never read by the recommendation-profile refresher and never influence recommendation weights.

| Signal | Treatment |
| --- | --- |
| Completed topics and progress | Strong explicit learning evidence |
| Bookmarks | Strong explicit save/interest evidence |
| Topic likes | Explicit positive topic interest |
| Comments written, comment likes and replies written | Explicit community interaction evidence |
| User-selected categories | Stored separately and treated as a strong user-declared preference |

The model uses only eligible account actions recorded after consent, with a maximum 180-day evidence window. Profile refreshes are cached for five minutes. It maintains separate short-term (14-day half-life) and long-term (90-day half-life) scores. Per-topic scores and evidence are capped, and profile rows are removed when their supporting evidence ages out. Explicit category interests are stored separately and combined with the derived topic-interest profile.

The recommendation service preserves its existing category-weighted scheduling, category-diversity rule, pagination cursor and topic-only content ordering. Cursors carry the `explicit-actions-v3` model version. When an active cursor carries an older or missing version, the server rebuilds category weights from explicit account actions while preserving per-category served counts, keyset positions, the last category and the diversity streak. **All account-history recommendation weighting is consent-gated**, including progress/completions, bookmarks, topic likes, comments, explicit-action-derived topic scores and explicit category interests. Passive analytics measurements—including impressions, reading duration, swipe depth, skips, return visits and Top Comments exposure—are never used for personalisation or recommendation ranking. Without personalisation consent, category weights are neutral and completed-topic suppression is disabled. If consent is withdrawn during an active feed cursor, the RPC immediately normalises its category weights and stops excluding completed topics; it does not wait for a new session.

Turning personalisation off immediately deletes the derived topic-interest profile and selected category-interest rows, records withdrawal, and stops all account-history recommendation weighting. Historical operational analytics events are not deleted by this action; they remain in the separate analytics pipeline under its existing 180-day raw-event retention policy and are never used for personalisation.

The profile is private: it is not exposed through public profiles and is not used for sponsor targeting. No raw profile or user-level event data is returned to the administrator dashboard.

**Important:** Catholic reading and engagement can reveal religious beliefs, which may be special-category personal data under UK GDPR. The explicit opt-in is a technical safeguard, not a substitute for a complete privacy notice, retention explanation, lawful-basis assessment, DPIA screening, data-subject process or legal review. The remaining legal readiness items are tracked in [Privacy and legal implementation notes](privacy-and-legal-implementation.md).

## Database objects

- `catho_private.user_personalization_consents`: per-account opt-in, version and withdrawal timestamps.
- `catho_private.user_topic_interest_scores`: private per-topic score, explicit-action evidence, short-/long-term values, model version and refresh time; the legacy inferred-score field remains zero for schema compatibility.
- `catho_private.user_explicit_category_interests`: categories directly selected by the account owner.
- `public.set_my_personalization_consent(boolean)`: authenticated owner-only consent change; withdrawal deletes derived profile and explicit category selections.
- `public.get_my_personalization_status()`: authenticated owner-only status and available category options.
- `public.set_my_personalization_interests(text[])`: validates and replaces the current user's selected categories.
- `catho_private.refresh_user_interest_profile(uuid)`: private recomputation from explicit account actions only; not executable by app roles.
- `catho_private.get_user_feed_preference_signals(uuid)`: owner-checked recommendation helper; returns explicit-action and selected-category signals only while opted in.
- `catho_private.get_user_recommendation_category_weights(uuid)`: private, consent-checked helper shared by first-page ranking and active-cursor rebasing; explicit account actions only.
- `public.get_admin_analytics_deep_dive(uuid,timestamptz,timestamptz)`: admin-verified aggregate-only reporting function, callable only by the service role.

All profile tables are in the private schema, have RLS enabled, and have no direct client grants. Public RPCs derive identity from `auth.uid()`; callers cannot pass another account ID.

## Administrator analytics

The unified `/admin/analytics` page now adds:

- Feed reading funnel: feed impressions and sessions reaching viewability, completion or skip.
- Session quality: distinct signed-in feed sessions, average topic entries, active time, completions and low-active-time sessions.
- Recommendation outcomes: actual feed-origin topic entries followed by viewability, active time, completion, skip and return behaviour.
- Cohort retention: first-observed feed cohorts with 7-day and 30-day return rates, counting a return only when it occurs in a distinct feed session. A rate remains unavailable until the cohort has a complete observation window; it is never shown as a false zero.
- Category discovery: published topic coverage, impressions, viewability and completions by category.
- Current-period overview: daily trend graph plus five navigation cards; duplicate previous-period comparison cards and duplicate entity-count rows are intentionally omitted while detailed category/topic/sponsor/comment sections remain.

All report payloads are aggregated. They do not return user IDs, session IDs, raw comment text or individual activity histories. The current recommendation report measures outcomes for topics users actually entered. It is not a randomized A/B experiment and does not claim to measure unshown candidate topics. Period-over-period changes are descriptive comparisons, not statistical-significance claims.

The date range remains capped at 180 days because identifier-bearing raw analytics are retained for 180 days. Daily user-free aggregates continue to support the existing historical trend views.

## Data interpretation and current limitations

- Recommendation-profile signals come only from explicit signed-in account actions after separate recommendation consent. Operational analytics events are separate and never used to build or refresh the profile. General feed ranking consumes site-wide daily topic aggregates from signed-in and signed-out activity; anonymous rows contain no visitor identifiers and do not create a visitor-specific profile. Admin analytics displays signed-in and anonymous event counts separately. No anonymous unique-person or session count is inferred.
- Topic and comment-card raw event tables currently have relatively low volume. Early rates can be volatile and should be interpreted alongside denominators.
- Historical events can only support metrics that were actually collected. Comment-card exposure history cannot be reconstructed before its instrumentation was deployed.
- The current content model has category and topic identifiers but no governed subtopic/tag taxonomy. Subtopic affinities should not be fabricated from free-text or inferred religious labels. Add curated topic tags before implementing that layer.
- Candidate-level recommendation experiments need explicit assignment and exposure identifiers, including actual viewport entry, position and experiment variant. The current dashboard therefore reports observed feed outcomes rather than claiming A/B lift.
- Sponsor performance remains isolated from organic recommendations and should be evaluated using served, viewable and click-through metrics in its own reporting stream.

## Verification

The live deep-dive RPC was smoke-tested for a 30-day administrator reporting window. It returned aggregate funnel, session, category and recommendation outcomes, and correctly returned unavailable retention rates for cohorts that had not matured through the full observation window.

The Supabase security and performance advisors were rerun after the schema changes. New profile tables are private and direct client grants are revoked. The advisors continue to report existing project-wide private-schema RLS-without-policy notices and existing authenticated SECURITY DEFINER RPC notices; these need to be assessed against their intended function contracts rather than broadly suppressing the findings. The new profile foreign-key indexes were added after the performance advisor identified missing coverage.

The versioned database upgrade is [personalization-analytics-upgrade.sql](personalization-analytics-upgrade.sql). The canonical fresh-project SQL bootstrap includes the same personalisation tables, functions, indexes and grants. The live project still has the previous analytics-coupled profile refresher. PR26 updates the canonical bootstrap and existing upgrade SQL; the production SQL change is applied directly after merge.
