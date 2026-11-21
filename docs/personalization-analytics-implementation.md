# Personalisation and analytics implementation

## Scope

This upgrade adds an optional, account-controlled recommendation-interest profile and extends the administrator analytics hub with feed quality, session, recommendation-outcome, category-discovery and cohort-retention reporting.

The measurement streams remain technically separate. Eligible feed and Top Comments events serve operational reporting and, only under the linked personalisation/Service improvement opt-in, the user's private recommendation profile:

- Topic feed telemetry stays in `catho_private.feed_analytics_events` and its daily aggregates.
- Top Comments exposure stays in `catho_private.feed_card_analytics_events` and its daily aggregates.
- Paid sponsor served, viewable and click events stay in the sponsor campaign pipeline.
- Existing likes, bookmarks, progress, comments, comment likes and replies remain in their original interaction tables.

Sponsor delivery signals are never added to organic topic recommendation weights.

**Production rollout status:** production currently reads `feed_analytics_events` and `feed_card_analytics_events` when personalisation is enabled, but the live consent path does not yet require Service improvement analytics to be enabled at the same time. This change makes the dependency explicit: personalisation enables Service improvement analytics, the service-analytics control is locked while personalisation is active, and the profile refresher checks both consent records. Existing v3 opt-ins are withdrawn and must be renewed under v4. The production SQL upgrade and app release are still pending.

## Feed ranking and measurement layers

These systems are deliberately separate. The general feed is a site-wide popularity/quality ranking; personalisation changes category allocation for one opted-in account; Top Comments has its own engagement ranking; sponsors use campaign rotation. Sponsor events never enter organic ranking.

### General topic feed

The public general feed uses daily site-wide aggregates from both signed-in Service improvement events and signed-out anonymous topic aggregates. It does not build or query a visitor-specific profile. For each published topic, the 90-day signal score is:

- viewable impressions: +1.00 each;
- impressions: +0.12 each;
- completions: +2.00 each;
- active reading: +0.18 per minute, capped at 60 minutes per daily row;
- skips: -0.35 each.

Each daily contribution is decayed by `exp(-age_in_days / 45)`. The score also adds logarithmically scaled public topic likes (+1.2 multiplier), bookmarks (+1.0), and top-level comments (+0.8). A low-exposure bonus of `2 / sqrt(1 + viewable_impressions)` gives newer or under-exposed topics some opportunity to surface. Topics are ranked within each category by this score, then curated `order_index` and topic ID. The feed selects the least-served category first and avoids a third consecutive topic from the same category where alternatives exist.

Signed-out aggregate events contribute to this site-wide ranking even if a visitor has declined account-linked analytics. They are not connected to a signed-out visitor profile.

### Personalised topic feed

Personalisation does not replace the general feed with a per-topic score sort. It changes how frequently each category is selected:

1. Build a private per-topic profile from eligible account actions and passive reading signals recorded after the current personalisation grant.
2. Sum topic-interest scores by category and add a strong declared-interest weight of 8 for each category the user selected.
3. Convert each category score into a scheduling weight: `1 + sqrt(max(category_score, 0))`.
4. Select the category with the lowest `served_count / weight`, while avoiding a third consecutive topic from one category.
5. Within the selected category, topics remain in curated `order_index, id` order. Completed topics are suppressed while personalisation is active; if the initial feed has no uncompleted topics, it falls back to completed topics.

The profile includes progress/completions (+5), bookmarks (+4), topic likes (+3), comments (+3), comment likes (+3), replies (+2.5), and smaller Top Comments exposure/open signals. Passive feed signals are independently capped per topic and horizon: viewability +1.20, active reading +1.50, swipe depth +1.50, completions +3.00 and return visits +1.50. The 14-day half-life score contributes 35%; the 90-day half-life score contributes 65%. Skips are negative only after at least two distinct sessions, at -1.50 per session with a 30-day half-life and a -3.00 cap. The final topic score is clamped to -4 through +8.

Personalisation requires Service improvement analytics to be enabled. Turning personalisation off deletes the derived profile and selected categories, stops profile-based category weighting, and restores the neutral general scheduling path. Sponsor measurement is never an input.

### Top Comments

Top Comments is not personalised. It considers up to the 5,000 newest eligible top-level comments from the last 90 days. Its engagement score is:

`(likes + 2 × distinct reply authors + 0.5 × likes in the last 14 days + distinct reply authors in the last 14 days) / (1 + comment_age_in_weeks)`

A comment must meet the minimum engagement threshold (at least three combined likes/reply authors, with at least two likes or one distinct reply author). Ties are broken by recency and comment ID. This favours substantive discussion while allowing recent engagement to matter more.

### Sponsor rotation

Sponsor selection is separate from all organic feed algorithms. A campaign must be approved, active, within its dates, paid/cleared, and match its category/topic targeting. Daily and lifetime impression caps apply. Eligible campaigns are rotated using their recent 30-day viewable-impression count divided by placement weight, with a random tie-breaker. When Sponsor measurement is enabled, account-level frequency limits also apply. When it is declined, delivery continues and only campaign/day served totals are recorded; no individual frequency, viewability or click measurement is collected.

### What each layer measures

| Layer | Data used | Identity level | Used for |
| --- | --- | --- | --- |
| General topic ranking | Daily topic engagement aggregates, public likes/bookmarks/comments | Site-wide aggregate | Same broad ranking for signed-in and signed-out visitors |
| Service improvement analytics | Signed-in topic and Top Comments events; site performance | Account-linked | Operational reporting and service improvement |
| Signed-out topic/comment statistics | Event UUIDs, public entity IDs and bounded metrics, rolled into daily totals | No visitor/session/account ID | Site-wide ranking and aggregate reporting; free objection available |
| Personalisation | Post-consent account actions, reading signals and selected categories | Private account profile | Category scheduling and completed-topic suppression |
| Sponsor delivery | Campaign eligibility, target context, served totals and global caps | Campaign/day | Deliver and pace paid placements |
| Sponsor measurement | Viewability, clicks and frequency events | Signed-in account-linked events with per-placement IDs for event validation and account-level frequency controls; signed-out visitors are not individually measured | Sponsor performance reporting and frequency controls |

## Personalisation privacy model

Personalisation is **off by default**. The account owner must explicitly opt in using the separate signup checkbox or Account → Personalisation. The consent record is versioned and belongs to the authenticated account. Signup consent is captured by an `auth.users` insert trigger from the one-time signup metadata value; subsequent user-metadata edits do not re-enable it. The browser cannot read or write the private profile tables directly.

When enabled, the private topic-interest profile is recomputed from eligible explicit account actions and passive reading signals recorded after recommendation consent. Enabling personalisation also enables Service improvement analytics; the account cannot disable that analytics choice until personalisation is turned off. The profile uses viewable impressions, active reading duration, swipe depth, skips, completions, return visits and eligible Top Comments exposure alongside progress, bookmarks, likes, comments, comment likes, replies and user-selected categories. Sponsor measurement is never used for recommendations.

| Signal | Treatment |
| --- | --- |
| Completed topics and progress | Strong explicit learning evidence |
| Viewable impressions, active duration and swipe depth | Positive reading/engagement evidence, with bounded weights and recency decay |
| Skips | Negative signal only after repeated skips in separate sessions |
| Return visits and completion | Positive repeat-engagement and completion evidence |
| Top Comments exposure and reading | Small topic-interest signal, separate from sponsor measurement |
| Bookmarks | Strong explicit save/interest evidence |
| Topic likes | Explicit positive topic interest |
| Comments written, comment likes and replies written | Explicit community interaction evidence |
| User-selected categories | Stored separately and treated as a strong user-declared preference |

The model uses only eligible account actions and reading signals recorded after consent, with a maximum 180-day evidence window. Profile refreshes are cached for five minutes. It maintains separate short-term (14-day half-life) and long-term (90-day half-life) scores. Per-topic scores and evidence are capped, and profile rows are removed when their supporting evidence ages out. Explicit category interests are stored separately and combined with the derived topic-interest profile.

Passive reading signals are capped independently for each topic before they are combined, preventing repeated exposure from crowding out other evidence. For each short- and long-term score, the per-topic caps are: viewable impressions +1.20; active reading +1.50; swipe depth +1.50; completions +3.00; and return visits +1.50. Each signal is first weighted and decayed, then its own cap is applied. The short-term score uses a 14-day half-life and the long-term score a 90-day half-life; the final positive score blends them 35%/65%. Repeated skips are negative only after at least two distinct feed sessions, weighted at -1.50 per session with a 30-day half-life and capped at -3.00. The final per-topic score is clamped to -4 through +8. The stored inferred score is a separate diagnostic signal and is not added a second time to the final blend.

The recommendation service preserves its existing category-weighted scheduling, category-diversity rule, pagination cursor and topic-only content ordering. Cursors carry the `activity-signals-v4` model version. When an active cursor carries an older or missing version, the server rebuilds category weights from consented activity signals while preserving per-category served counts, keyset positions, the last category and the diversity streak. **All account-history recommendation weighting is consent-gated**, including progress/completions, bookmarks, topic likes, comments, explicit-action-derived topic scores and explicit category interests. Passive reading measurements are used only while both personalisation and Service improvement analytics consent are active. Turning off personalisation deletes the derived profile and stops recommendation weighting; the independent Service improvement analytics choice can then be withdrawn separately. Without personalisation consent, category weights are neutral and completed-topic suppression is disabled. If consent is withdrawn during an active feed cursor, the RPC immediately normalises its category weights and stops excluding completed topics; it does not wait for a new session.

Turning personalisation off immediately deletes the derived topic-interest profile and selected category-interest rows, records withdrawal, and stops all account-history recommendation weighting. Historical operational analytics events are not deleted by this action; they remain under the existing 180-day raw-event retention policy. They are used for recommendation weighting only while personalisation and its linked Service improvement analytics permission are active.

The profile is private: it is not exposed through public profiles and is not used for sponsor targeting. No raw profile or user-level event data is returned to the administrator dashboard.

**Important:** Catholic reading and engagement can reveal religious beliefs, which may be special-category personal data under UK GDPR. The explicit opt-in is a technical safeguard, not a substitute for a complete privacy notice, retention explanation, lawful-basis assessment, DPIA screening, data-subject process or legal review. The remaining legal readiness items are tracked in [Privacy and legal implementation notes](privacy-and-legal-implementation.md).

## Database objects

- `catho_private.user_personalization_consents`: per-account opt-in, version and withdrawal timestamps.
- `catho_private.user_topic_interest_scores`: private per-topic score, explicit and inferred evidence, short-/long-term values, model version and refresh time.
- `catho_private.user_explicit_category_interests`: categories directly selected by the account owner.
- `public.set_my_personalization_consent(boolean, text)`: authenticated owner-only v4 consent change; new grants require the current disclosure version and withdrawal deletes derived profile and explicit category selections.
- `public.set_my_personalization_consent(boolean)`: legacy withdrawal-only wrapper; attempts to grant consent from older clients are rejected.
- `public.get_my_personalization_status()`: authenticated owner-only status and available category options.
- `public.set_my_personalization_interests(text[])`: validates and replaces the current user's selected categories.
- `catho_private.refresh_user_interest_profile(uuid)`: private recomputation from eligible account actions and consented reading signals; not executable by app roles.
- `catho_private.get_user_feed_preference_signals(uuid)`: owner-checked recommendation helper; returns derived reading signals and selected-category signals only while both consent records are active.
- `catho_private.get_user_recommendation_category_weights(uuid)`: private, consent-checked helper shared by first-page ranking and active-cursor rebasing; reads the profile only when personalisation and Service improvement analytics are enabled.
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

- Recommendation-profile signals combine explicit signed-in account actions with consented reading analytics after personalisation opt-in. The opt-in also enables Service improvement analytics, which cannot be disabled until personalisation is turned off. Sponsor measurement remains separate and is never used for recommendation weighting. General feed ranking consumes site-wide daily topic aggregates from signed-in and signed-out activity; anonymous rows contain no visitor identifiers and do not create a visitor-specific profile. Admin analytics displays signed-in and anonymous event counts separately. No anonymous unique-person or session count is inferred.
- Topic and comment-card raw event tables currently have relatively low volume. Early rates can be volatile and should be interpreted alongside denominators.
- Historical events can only support metrics that were actually collected. Comment-card exposure history cannot be reconstructed before its instrumentation was deployed.
- The current content model has category and topic identifiers but no governed subtopic/tag taxonomy. Subtopic affinities should not be fabricated from free-text or inferred religious labels. Add curated topic tags before implementing that layer.
- Candidate-level recommendation experiments need explicit assignment and exposure identifiers, including actual viewport entry, position and experiment variant. The current dashboard therefore reports observed feed outcomes rather than claiming A/B lift.
- Sponsor performance remains isolated from organic recommendations and should be evaluated using served, viewable and click-through metrics in its own reporting stream.

## Verification

The live deep-dive RPC was smoke-tested for a 30-day administrator reporting window. It returned aggregate funnel, session, category and recommendation outcomes, and correctly returned unavailable retention rates for cohorts that had not matured through the full observation window.

The Supabase security and performance advisors were rerun after the schema changes. New profile tables are private and direct client grants are revoked. The advisors continue to report existing project-wide private-schema RLS-without-policy notices and existing authenticated SECURITY DEFINER RPC notices; these need to be assessed against their intended function contracts rather than broadly suppressing the findings. The new profile foreign-key indexes were added after the performance advisor identified missing coverage.

The versioned database upgrade is [personalization-analytics-upgrade.sql](personalization-analytics-upgrade.sql). The canonical fresh-project SQL bootstrap includes the same personalisation tables, functions, indexes and grants. The live project still has the previous analytics-coupled profile refresher. PR26 updates the canonical bootstrap and existing upgrade SQL; the production SQL change is applied directly after merge.

**Consent-version transition:** the activity-signal consent wording is version `2026-11-20-v4`. Existing accounts that accepted the earlier v3 wording are switched off during the upgrade and their derived profile/category rows are deleted; they must explicitly opt in again after seeing the updated disclosure. Their separately granted Service improvement analytics choice, if any, remains unchanged.

**Disclosure-version enforcement:** new opt-ins require `2026-11-20-v4` from the signup metadata or the two-argument personalisation RPC. The legacy one-argument RPC remains available only to withdraw consent; attempts to enable through older clients are rejected. The signup trigger ignores legacy metadata without the v4 disclosure marker.
