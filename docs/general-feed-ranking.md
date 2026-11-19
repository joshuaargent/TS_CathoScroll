# General feed ranking

## Purpose

CathoScroll has two distinct ranking layers:

1. **General ranking** is the default for signed-out visitors and signed-in accounts with personalisation disabled. It uses site-wide engagement and public content interactions. It does not read a visitor's account history.
2. **Personalised ranking** is available only after a user explicitly enables personalisation. The existing recommendation RPC uses that account's eligible activity signals to adjust category weights.

Personalisation is not required to receive a ranked feed.

## General ranking signals

The production function is `public.get_public_general_topic_page(jsonb, integer)`. It ranks published topics using the rolling 90-day window from `catho_private.feed_analytics_daily`:

- Viewable impressions: strongest exposure signal.
- Impressions: smaller contribution, to avoid treating every loaded card as meaningful engagement.
- Completions: positive quality signal.
- Active reading duration: positive signal, capped per daily aggregate to reduce runaway values.
- Skips: negative signal.
- Recency: each day's contribution decays exponentially with a 45-day decay constant (`exp(-age_days / 45)`).
- Public engagement: topic likes, bookmarks and visible top-level comments contribute logarithmically.

The score is deliberately transformed so that a topic with a very large historical audience does not permanently dominate newer material. This is a practical engagement ranking, not a theological judgement about the correctness or importance of a topic.

## Diversity and pagination

The selector keeps a per-category served count and offset in its opaque cursor. It chooses the highest-scoring next topic from the least-served eligible category. It avoids a third consecutive topic from the same category where another category has eligible content. Within each category, topics are ordered by general score, then the existing editorial `order_index`, then stable topic ID.

The cursor records category offsets so the same topic is not intentionally selected twice during ordinary pagination. The ranking score is recomputed when a new page is requested, so engagement changes can affect later pages; already-loaded cards are kept in the active feed session.

The general path includes completed topics. It does not consult `progress`, bookmarks, likes, comments or feed telemetry belonging to the current visitor. Signed-out and opted-out visitors therefore receive the same general ranking logic.

## Sponsor separation

Sponsor selection is a separate paid-placement system. Sponsor delivery must not modify organic topic scores or category weights. Sponsor targeting may use campaign-level category/topic eligibility, but it must not use an individual's recommendation profile or expose personal reading histories to sponsors.

## Operational and privacy notes

General ranking consumes aggregate site-wide topic metrics. Those metrics currently originate from the existing authenticated first-party analytics rollups; they are not yet a complete measure of signed-out activity. Do not describe the current rollups as including anonymous visitors until the separate anonymous analytics pipeline and reporting changes are implemented and verified.

The ranking function is part of the emergency clean-project bootstrap at `docs/cathoscroll-database-bootstrap.sql`. Production schema changes were applied directly to Supabase; no standalone SQL migration file is maintained for this change.

## Validation performed

- Applied the function directly to the production Supabase database.
- Executed the function against the live published catalogue and confirmed it returned ranked topic records, category slugs and a continuation cursor.
- The application integration is on the open draft PR branch. A full application build and automated test run are still required before deployment.
