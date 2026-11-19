# Personalisation and analytics implementation

## Scope

This upgrade adds an optional, account-controlled recommendation-interest profile and extends the administrator analytics hub with feed quality, session, recommendation-outcome, category-discovery and cohort-retention reporting.

The existing measurement streams remain separate:

- Topic feed telemetry stays in `catho_private.feed_analytics_events` and its daily aggregates.
- Top Comments exposure stays in `catho_private.feed_card_analytics_events` and its daily aggregates.
- Paid sponsor served, viewable and click events stay in the sponsor campaign pipeline.
- Existing likes, bookmarks, progress, comments, comment likes and replies remain in their original interaction tables.

Sponsor delivery signals are never added to organic topic recommendation weights.

## Personalisation privacy model

Personalisation is **off by default**. The account owner must explicitly enable it from Account → Personalisation. The consent record is versioned and belongs to the authenticated account. The browser cannot read or write the private profile tables directly.

When enabled, the private topic-interest profile is recomputed from bounded, decaying evidence:

| Signal | Treatment |
| --- | --- |
| Topic viewable impression | Weak positive evidence |
| Active reading duration | Weak positive evidence, capped at 60 seconds per event |
| Slide depth | Weak positive evidence, capped at four slides |
| Topic completion | Strong positive evidence |
| Return visit | Moderate positive evidence |
| Topic skips | Negative evidence only after at least two distinct sessions |
| Topic likes and bookmarks | Strong explicit interaction evidence |
| Progress completion | Strong explicit interaction evidence |
| Comments written, comment likes and replies written | Explicit community interaction evidence |
| Top Comments viewability, active time and discussion opens | Low-to-moderate topic evidence |

The model uses separate short-term (14-day half-life) and long-term (90-day half-life) scores, a 90-day behavioural evidence window, and a 180-day explicit-interaction evidence window. Per-topic scores and evidence are capped. A category preference is calculated from the topic profile, then combined with user-selected category interests. Explicit category interests are stored separately and receive a stronger category signal.

The recommendation service still preserves its existing category-weighted scheduling, category-diversity rule, pagination cursor and topic-only content ordering. Behavioural profile signals are read only when consent is enabled. Existing direct learning actions continue to work as explicit product interactions even when the optional inferred profile is disabled.

Turning personalisation off immediately deletes the derived topic-interest profile and selected category-interest rows, records withdrawal, and stops behavioural profile weighting. Historical operational analytics events are not deleted by this action; they remain in the separate analytics pipeline under its existing 180-day raw-event retention policy. They are no longer used for personalisation while consent is disabled.

The profile is private: it is not exposed through public profiles and is not used for sponsor targeting. No raw profile or user-level event data is returned to the administrator dashboard.

**Important:** Catholic reading and engagement can reveal religious beliefs, which may be special-category personal data under UK GDPR. The explicit opt-in is a technical safeguard, not a substitute for a complete privacy notice, retention explanation, lawful-basis assessment, data-subject process or legal review. Obtain appropriate privacy/legal review before enabling this feature for production users.

## Database objects

- `catho_private.user_personalization_consents`: per-account opt-in, version and withdrawal timestamps.
- `catho_private.user_topic_interest_scores`: private per-topic score, positive/negative evidence, short-/long-term values, explicit/inferred split, model version and refresh time.
- `catho_private.user_explicit_category_interests`: categories directly selected by the account owner.
- `public.set_my_personalization_consent(boolean)`: authenticated owner-only consent change; withdrawal deletes derived profile and explicit category selections.
- `public.get_my_personalization_status()`: authenticated owner-only status and available category options.
- `public.set_my_personalization_interests(text[])`: validates and replaces the current user's selected categories.
- `catho_private.refresh_user_interest_profile(uuid)`: private recomputation function; not executable by app roles.
- `catho_private.get_user_feed_preference_signals(uuid)`: owner-checked recommendation helper; returns no inferred profile signals unless opted in.
- `public.get_admin_analytics_deep_dive(uuid,timestamptz,timestamptz)`: admin-verified aggregate-only reporting function, callable only by the service role.

All profile tables are in the private schema, have RLS enabled, and have no direct client grants. Public RPCs derive identity from `auth.uid()`; callers cannot pass another account ID.

## Administrator analytics

The unified `/admin/analytics` page now adds:

- Feed reading funnel: feed impressions and sessions reaching viewability, completion or skip.
- Session quality: distinct signed-in feed sessions, average topic entries, active time, completions and low-active-time sessions.
- Recommendation outcomes: actual feed-origin topic entries followed by viewability, active time, completion, skip and return behaviour.
- Cohort retention: first-observed feed cohorts with 7-day and 30-day return rates. A rate remains unavailable until the cohort has a complete observation window; it is never shown as a false zero.
- Category discovery: published topic coverage, impressions, viewability and completions by category.

All report payloads are aggregated. They do not return user IDs, session IDs, raw comment text or individual activity histories. The current recommendation report measures outcomes for topics users actually entered. It is not a randomized A/B experiment and does not claim to measure unshown candidate topics.

The date range remains capped at 180 days because identifier-bearing raw analytics are retained for 180 days. Daily user-free aggregates continue to support the existing historical trend views.

## Data interpretation and current limitations

- Current telemetry is authenticated-account telemetry. It must be labelled as signed-in activity, not total site traffic. Anonymous users are not silently fingerprinted or profiled.
- Topic and comment-card raw event tables currently have relatively low volume. Early rates can be volatile and should be interpreted alongside denominators.
- Historical events can only support metrics that were actually collected. Comment-card exposure history cannot be reconstructed before its instrumentation was deployed.
- The current content model has category and topic identifiers but no governed subtopic/tag taxonomy. Subtopic affinities should not be fabricated from free-text or inferred religious labels. Add curated topic tags before implementing that layer.
- Candidate-level recommendation experiments need explicit assignment and exposure identifiers, including actual viewport entry, position and experiment variant. The current dashboard therefore reports observed feed outcomes rather than claiming A/B lift.
- Sponsor performance remains isolated from organic recommendations and should be evaluated using served, viewable and click-through metrics in its own reporting stream.

## Verification

The live deep-dive RPC was smoke-tested for a 30-day administrator reporting window. It returned aggregate funnel, session, category and recommendation outcomes, and correctly returned unavailable retention rates for cohorts that had not matured through the full observation window.

The Supabase security and performance advisors were rerun after the schema changes. New profile tables are private and direct client grants are revoked. The advisors continue to report existing project-wide private-schema RLS-without-policy notices and existing authenticated SECURITY DEFINER RPC notices; these need to be assessed against their intended function contracts rather than broadly suppressing the findings. The new profile foreign-key indexes were added after the performance advisor identified missing coverage.

The versioned database upgrade is [personalization-analytics-upgrade.sql](personalization-analytics-upgrade.sql). The canonical fresh-project SQL bootstrap includes the same personalisation tables, functions, indexes and grants. The live project was updated through the corresponding database migrations.
