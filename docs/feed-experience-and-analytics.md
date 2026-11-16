# Feed Experience, Sponsorships, and Analytics

## Product constraints

- Existing topic cards and their five-slide topic-reading experience remain the primary feed experience.
- Do not redesign or replace topic cards as part of feed diversification. Changes to topic ranking must preserve the current card UI and navigation.
- The website and native applications continue to share feed and topic presentation wherever the current architecture supports it.
- The currently planned premium features become free. Do not introduce membership gating in this work.
- Sponsorships are clearly disclosed, brand-approved placements, not disguised organic recommendations.
- Feed analytics must measure meaningful learning and discovery, not maximise compulsive scrolling or raw time spent.

## Feed card types and ordering

The feed is a sequence of typed feed items. The first implementation adds sponsorship and top-comment items while keeping topic items unchanged. Quiz items are a later extension.

Initial insertion cadence, measured in topic cards rather than total feed items:

- Top comments: eligible approximately every 5 topic cards.
- Sponsorships: eligible approximately every 10 topic cards.
- If a card type has no eligible content, omit the card and continue the feed. Do not insert placeholders or empty cards.
- Cadence is a target, not a guarantee: no eligible content, frequency caps, sponsor pacing, and user history can defer or suppress an insertion.
- The scheduler must avoid consecutive non-topic cards and should not let one card type starve the other.

## Sponsorship cards

A sponsorship card contains up to five sponsor positions. It loops/rotates through eligible sponsors and only renders populated positions. If fewer than five sponsors are eligible, the card has fewer positions; if none are eligible, the card is omitted.

Sponsors are selected from an approved, active campaign pool. Each campaign has a sponsor, creative, destination URL, schedule, eligible categories or topics, paid weight, frequency caps, and status. All outbound links are validated and opened safely. Every placement is labelled as sponsorship.

### Weighted allocation

Paid weight controls a sponsor's proportional share of eligible sponsor impressions. For example, weights 2:1 produce an expected allocation of roughly two impressions to the first sponsor for every one to the second across a sufficiently large sample. This is probabilistic pacing, not a promise that every individual three-slot card contains exactly two and one.

The scheduler must:
- Use weighted selection among eligible campaigns.
- Enforce campaign start/end dates and active status.
- Apply per-user and global frequency caps.
- Avoid immediate repetition where alternatives exist.
- Keep category targeting and brand-suitability rules.
- Record eligible opportunities, rendered impressions, clicks, and cap/eligibility decisions separately.
- Never count a sponsor impression until the placement meets a defined viewability threshold.
- Keep sponsor events separate from organic topic recommendation signals.

A proposed commercial starting point is £25/month for one weight unit, with higher tiers buying proportionally more share of the eligible impression pool. This is a product/pricing proposal only; do not activate billing or promise guaranteed impressions until inventory, traffic, viewability, reporting, refunds, and payment integration are defined. Sponsor pricing and campaign weight must be controlled server-side, never trusted from browser input.

## Sponsor management and accounts

Add an administrator sponsorship area modelled on the existing Content Library management experience. Administrators can create and edit sponsors, approve or suspend them, manage creatives and destination URLs, set campaign dates, targeting, frequency caps, and paid weight, and review performance.

Sponsor accounts are distinct from administrator accounts. A sponsor user is linked to exactly the sponsor organisation they represent and can only view that sponsor's campaigns, creatives, invoices/status, and analytics. Sponsor users cannot access other sponsors, user-level data, admin tools, or raw event records. Sponsor membership and permissions are managed by administrators.

Billing is a later phase. The data model should be ready for a payment provider and subscription state, but do not store card details or trust client-submitted payment status.

## Top-comment cards

A top-comment card contains up to five eligible top-level comments. Horizontal swipes move between comments inside the card; they do not immediately navigate away. Each comment shows its text, author, original topic, like count, reply count, and a clear action to open the original discussion. Tapping the comment or its discussion action opens the topic discussion focused on that comment.

The card has exactly as many positions as eligible comments (one to five). No eligible comments means no card. Previously seen comments should be deprioritised to avoid repetition.

Only published-topic comments that are not deleted and are not hidden by moderation are eligible. Replies are counted as engagement but are not independently promoted as top-level feed entries in the first version. Add an explicit minimum engagement threshold before ranking; the initial threshold should require meaningful positive activity (for example, at least 3 combined likes and replies, with a minimum of 2 likes or 1 reply). Keep the threshold configurable server-side so it can be tuned from real data. Rank using recency, likes, replies, and quality/safety signals; do not rank by lifetime likes alone. Pinned comments do not bypass moderation or eligibility rules.

## Quizzes (later phase)

Quizzes are separate managed content entities linked to one or more topics and categories. This avoids making a quiz a fragile field embedded in a topic and allows quizzes to be reused, versioned, reported on, and managed independently. A topic can have multiple quizzes; a quiz can optionally cover multiple related topics.

A quiz feed item contains five questions. Users answer one question and swipe to the next. The final result screen links to a dedicated quiz route such as /quiz/[slug]. The route displays the quiz, the user's result, and attempt history as appropriate. A signed-in user gets a quiz history page showing all attempts and can reopen an individual quiz. Store attempts separately from quiz definitions so repeated attempts do not overwrite previous results. Quiz content, correct answers, explanations, scoring, and attempt writes are validated server-side.

## Analytics event foundation

Use one typed, versioned event pipeline for topic, comment, sponsor, and future quiz interactions. Do not create separate unrelated tracking implementations for each card type.

Core event concepts include:
- Impression and viewability-qualified impression.
- Active visible duration, excluding background time and hidden cards.
- Skip / early exit.
- Swipe depth and card completion.
- Topic slide progression and topic completion.
- Likes, bookmarks, comments, replies, shares, and return visits where the current system exposes those actions.
- Comment-card impression, comment open, and discussion navigation.
- Sponsor eligible opportunity, viewable impression, click, and campaign attribution.
- Future quiz start, answer progression, completion, score band, and repeat attempt.

Events must be deduplicated, bounded, batched, rate-limited, and validated server-side. Do not accept arbitrary user IDs, campaign weights, counts, or event timestamps as authoritative. Use server receipt time for reporting; client time is diagnostic only. Avoid storing comment text, quiz answer text, or unnecessary personal data in analytics events.

Offline analytics must never block or delay bookmarks, likes, progress, notes, comments, or other user-facing actions. Analytics may be queued and retried independently; duplicate retries must not inflate counts. Define raw-event retention and retain aggregate reporting separately. Anonymous and signed-in activity should be distinguished without collecting unnecessary identifiers.

## Recommendation system

Extend the existing weighted-category recommendation RPC rather than replacing it. The current model already uses completed topics, bookmarks, likes, and commented topics to infer category preferences and balances category exposure.

New ranking signals should include:
- Viewability-qualified impressions.
- Active reading time and slide depth.
- Early skips, interpreted over repeated observations rather than a single skip.
- Topic completion.
- Likes, bookmarks, comments, and shares.
- Repeat visits.
- Topic quality and freshness.
- Category and topic diversity.
- Explicit user feedback if introduced later.

Use a bounded, explainable scoring model with decay and minimum sample sizes. Avoid letting a single event dominate a profile. Separate organic topic recommendations from sponsor allocation. Optimise for useful learning and discovery, not maximum session length. Preserve exploration so the feed does not become a narrow filter bubble. Cold-start and signed-out users retain a sensible diversified feed.

## Topic and category analytics

Administrators can access analytics at:
- /topic/[slug]/analytics
- /categories/[slug]/analytics

Add a clearly visible purple “View analytics” action beside the existing topic actions (including “Bookmark Topic”), and the equivalent action on category pages. Render these controls only after server-side administrator authorization; hiding a button is not an access-control mechanism.

Dashboards should use all reliable data already available in the database plus newly collected events. Show useful time-series charts, breakdowns, and comparisons rather than a wall of counters.

Topic analytics should cover, where data exists:
- Views, viewable impressions, unique viewers, active viewing time, median/average duration, skip rate, slide depth, completion, and repeat visits.
- Likes, bookmarks, comments, replies, shares, and engagement trends.
- Feed, category, search, related-topic, and direct discovery sources where attribution is reliably recorded.
- Daily/weekly/monthly trends and meaningful comparison periods.

Category analytics aggregate topic-level metrics and show topic leaders, topic distribution, growth, engagement, completion, and areas with limited content. Distinguish historical metrics that are unavailable from true zero values. Do not fabricate historical impressions or viewing time from existing likes/comments.

Sponsor analytics are separate and show eligible opportunities, viewable impressions, unique reach where measurable, clicks, click-through rate, frequency, and campaign trends. Sponsor dashboards expose only aggregate metrics for their own sponsor and never user identities or raw events.

## Security, privacy, performance, and reliability

- Enforce admin and sponsor authorization on the server and in database policies.
- Keep service-role credentials server-only.
- Validate every event type, entity reference, payload size, batch size, and rate limit.
- Deduplicate event IDs and make retries idempotent.
- Use bounded batch writes; never perform one database write per pointer movement or animation frame.
- Use indexed, time-bounded aggregate queries and daily rollups as traffic grows.
- Keep raw events in a private schema or otherwise inaccessible to normal clients.
- Do not let sponsor weights or sponsorship revenue alter organic recommendation scores.
- Apply data minimisation, retention limits, and applicable UK privacy/cookie requirements.
- Analytics failures must be non-fatal to the feed and must not interfere with existing offline synchronisation.
- Preserve website/native shared components and existing topic-card presentation.
- Test migrations against a disposable Supabase project and run security/performance advisors before production rollout.

## Delivery sequence

1. Audit current feed, admin, comment, rate-limit, offline queue, and database policy implementations.
2. Implement the event schema, validated ingestion, deduplication, retention/aggregation strategy, and automated tests.
3. Instrument existing topic interactions without changing the topic-card UI.
4. Extend recommendations using measured behaviour and diversity safeguards.
5. Add top-comment feed cards and eligibility thresholds.
6. Add sponsor organisations, admin campaign management, weighted delivery, and sponsor reporting.
7. Add admin topic/category analytics pages and graph components.
8. Add quiz entities, five-question feed cards, attempts, and dedicated quiz routes.
9. Add sponsor billing only after impression reporting and inventory have been validated.

Each phase should be independently reviewable and should not be merged or deployed until its checks pass.
