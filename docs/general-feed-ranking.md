# General feed ranking

## Purpose

CathoScroll has two distinct ranking layers:

1. **General ranking** is the default for signed-out visitors and signed-in accounts with personalisation disabled. It uses site-wide engagement and public content interactions. It does not read a visitor's account history.
2. **Personalised ranking** is available only after a user explicitly enables personalisation. Enabling it also enables and locks Service improvement analytics. The recommendation profile uses that account's explicit actions, selected categories, and passive feed/Top Comments reading signals recorded after the grant. It never uses sponsor measurement.

Personalisation is not required to receive a ranked feed.

## General ranking signals

The production function is `public.get_public_general_topic_page(jsonb, integer)`. It ranks published topics using the rolling 90-day window across `catho_private.feed_analytics_daily` (signed-in aggregates) and `catho_private.anonymous_feed_analytics_daily` (signed-out aggregates):

- Viewable impressions: strongest exposure signal.
- Impressions: smaller contribution, to avoid treating every loaded card as meaningful engagement.
- Completions: positive quality signal.
- Active reading duration: positive signal, capped per daily aggregate to reduce runaway values.
- Skips: negative signal.
- Recency: each day's contribution decays exponentially with a 45-day decay constant (`exp(-age_days / 45)`).
- Public engagement: topic likes, bookmarks and visible top-level comments contribute logarithmically.

The score is deliberately transformed so that a topic with a very large historical audience does not permanently dominate newer material. A separate exposure-based exploration bonus gives under-exposed topics a better chance to surface, preventing the feed from becoming a closed loop of the same winners. This is a practical engagement ranking, not a theological judgement about the correctness or importance of a topic.

The current weights are: viewable impressions +1.00; impressions +0.12; completions +2.00; active reading +0.18 per minute (up to 60 minutes per daily row); skips -0.35. Each daily contribution uses the 45-day exponential decay above. Public topic likes add `1.2 × ln(1 + likes)`, bookmarks add `1.0 × ln(1 + bookmarks)`, and top-level comments add `0.8 × ln(1 + comments)`. The exploration bonus is `2 / sqrt(1 + 90-day viewable impressions)`.

## Diversity and pagination

The selector keeps a per-category served count and offset in its opaque cursor. It chooses the highest-scoring next topic from the least-served eligible category. It avoids a third consecutive topic from the same category where another category has eligible content. Within each category, topics are ordered by general score, then the existing editorial `order_index`, then stable topic ID.

The score for each published topic is calculated once per page request and cached in an in-memory JSON ranking map for the selection loop. The cursor records category offsets so the same topic is not intentionally selected twice during ordinary pagination. The ranking score is recomputed when a new page is requested, so engagement changes can affect later pages; already-loaded cards are kept in the active feed session.

The general path includes completed topics. It does not consult `progress` or any bookmarks, likes, comments or feed telemetry belonging to the current visitor; public engagement counts and account-free site-wide aggregates are shared ranking inputs. Signed-out and opted-out visitors therefore receive the same general ranking logic.

## Category pages

A category page is a curated browse view, not the general popularity ranking and not the personalised feed. It filters published topics to the selected category and orders them by the editorial `order_index, id` cursor. It does not read account-level reading signals or signed-out aggregate analytics.

## Personalised category scheduling

The personalisation profile uses progress/completions (+5), bookmarks (+4), topic likes (+3), comments (+3), comment likes (+3), replies (+2.5), plus passive feed signals and smaller Top Comments exposure/open signals. Passive signals are capped independently per topic and horizon: viewability +1.20, active reading +1.50, swipe depth +1.50, completions +3.00 and return visits +1.50. A 14-day half-life score contributes 35% and a 90-day half-life score 65%. Skips count negatively only after at least two distinct sessions, at -1.50 per session with a 30-day half-life and a -3.00 cap. The final topic score is clamped to -4 through +8.

The recommendation RPC sums per-topic profile scores by category and adds 8 for each user-selected category. Each category's scheduling weight is `1 + sqrt(max(category_score, 0))`; the scheduler selects the category with the lowest `served / weight`, while avoiding a third consecutive topic from the same category. Topics inside the chosen category remain in curated `order_index, id` order; the model does not sort individual topics by their personal score. Completed topics are suppressed while personalisation is active, with a fallback to completed topics if the initial feed has no unfinished content. Turning personalisation off deletes the profile and selected category interests, restores neutral category weights, and stops completed-topic suppression.

## Sponsor separation

Sponsor selection is a separate paid-placement system. Sponsor delivery must not modify organic topic scores or category weights. Sponsor targeting may use campaign-level category/topic eligibility, but it must not use an individual's recommendation profile or expose personal reading histories to sponsors.

## Operational and privacy notes

General ranking consumes aggregate site-wide topic metrics from both the signed-in feed analytics daily rollup and the separate signed-out anonymous daily rollup. Anonymous topic impressions, viewable impressions, completions, active duration and skips contribute to the same site-wide score; they are never linked to a current visitor or used as a visitor-specific preference. The score remains an aggregate content-ranking signal, not a profile of signed-out readers. Anonymous comment and sponsor metrics are excluded from organic topic ranking.

The ranking function is part of the emergency clean-project bootstrap at `docs/cathoscroll-database-bootstrap.sql`. Production schema changes were applied directly to Supabase; no standalone SQL migration file is maintained for this change.

## Validation performed

- Applied the function directly to the production Supabase database and verified the anonymous aggregate source is included.
- Executed the function against the live published catalogue and confirmed it returned ranked topic records, category slugs and a continuation cursor.
- Verified two consecutive pages of ten topics had zero duplicate topic IDs.
- Optimised the scoring pass from repeated per-slot score calculation to one score calculation per page. After including both signed-in and anonymous daily rollups, a 24-topic production query measured approximately 74.8 ms on its first run and 18.9 ms on a warm repeat, with 3,761 shared-buffer hits on both runs. The earlier pre-optimisation measurement was approximately 76.7 ms and 12,007 buffer hits. These are single production measurements, not a load test.
- The application integration is on the open draft PR branch. A full application build and automated test run are still required before deployment.


## Signed-out analytics contribution

The general feed score now reads both account-free daily topic aggregates and anonymous daily topic aggregates over the same rolling 90-day window. This means signed-out engagement can influence which topics are generally surfaced to everyone, including signed-out and opted-out signed-in visitors. The query still reads no current viewer identity, account progress, or individual history. Anonymous daily data is weighted with the same viewability, completion, active-duration, skip and recency rules as signed-in daily aggregates; exposure-based exploration and category balancing continue to prevent a small set of high-volume topics from dominating.