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

The card has exactly as many positions as eligible comments (one to five). No eligible comments means no card. Previously seen comments should be deprioritised to avoid repetition. The first implementation tracks viewed comment IDs in memory for the active account/feed session and skips them in subsequent interstitials; persistent seen-state across sessions and devices is deferred.

Only visible, non-deleted, non-empty top-level comments on published topics in published categories are eligible. Replies contribute to engagement but are not independently promoted. The initial server-side threshold is at least 3 combined likes and distinct reply authors, with at least 2 likes or 1 distinct reply author; counting distinct reply authors reduces the effect of repeated replies from one account. The first implementation considers comments from the previous 90 days. Ranking combines lifetime likes, distinct reply authors, activity in the previous 14 days, and a weekly age-decay factor; it is not lifetime-like ordering. Pinned comments do not bypass the threshold or moderation filters. The initial selector is deterministic and does not yet suppress comments already seen by a user; per-user seen-state should be added alongside comment-card analytics rather than guessed locally.

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

The existing weighted-category RPC has been extended rather than replaced. It retains completed topics, bookmarks, likes and comments as strong signals and now incorporates signed-in feed telemetry when a new feed cursor is created. Category weights are frozen into that cursor so pagination remains deterministic; a refresh starts a new preference snapshot.

Feed signals use a 90-day window and a 30-day half-life:
- Viewable impression: +0.40, capped at +1.20 per topic.
- Active reading: +0.25 per active minute, capped at +1.50 per topic.
- Slide depth: up to +0.50 per reached slide event, capped at +1.50 per topic.
- Completion: +2.50 per event, capped at +3.00 per topic.
- Return visit: +0.75 per event, capped at +1.50 per topic.
- Early skip: -1.50 per distinct feed session, capped at -3.00, and applied only after skips occur in at least two distinct sessions for that topic.

The combined telemetry score is clamped between -4 and +6 per topic. Topic scores are aggregated by published category and combined with the existing explicit learning signals. The category weight remains at least 1, using the square root of the non-negative combined preference score; negative telemetry can reduce an existing preference but cannot eliminate baseline category exploration. The existing weighted round-robin selection and no-three-consecutive-category safeguard remain intact.

Telemetry is read through a private SECURITY DEFINER helper that checks `auth.uid()` against the requested account. Authenticated clients cannot read raw analytics rows or query another user's preference signals. A partial `(user_id, received_at)` index supports the 90-day lookup. The helper is invoked only when a new recommendation cursor is created, not for every page continuation.

This is a first bounded scoring model, not a trained machine-learning system. It deliberately avoids treating a single skip as dislike, caps repeated signals, decays older behaviour and preserves cold-start diversity. Topic freshness/quality scoring, explicit feedback and model evaluation against controlled experiments remain future work. Sponsor allocation stays separate from organic recommendations.

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

Implementation status on 16 November 2026:

1. **Feed/admin/comment/offline architecture review:** existing systems were inspected for this work; the offline activity architecture was preserved.
2. **Validated event schema, ingestion, deduplication and retention:** implemented; automated source checks pass, with deployed browser/native verification still outstanding.
3. **Topic interaction instrumentation:** implemented without changing the topic-card UI; deployed data collection begins when the combined release is deployed.
4. **Recommendation weighting and diversity safeguards:** first telemetry-weighted model implemented; quality/freshness scoring and measured experimentation remain future work.
5. **Top-comment feed cards and eligibility:** implemented; real inventory testing remains outstanding because production currently has no comments.
6. **Sponsor organisations, campaign management, weighted delivery and sponsor reporting:** initial private sponsor registration and manual bank-transfer recording are implemented in the admin dashboard. Public sponsor delivery, campaign creatives/targeting, frequency caps, weighted allocation, sponsor reporting and sponsor accounts remain unimplemented.
7. **Admin topic/category analytics and graphs:** implemented; admin/non-admin browser verification remains outstanding.
8. **Quiz entities, five-question feed cards, attempts and dedicated routes:** not started.
9. **Sponsor billing:** deferred until inventory, reporting, pricing and payment-provider requirements are validated.

Keep future phases independently reviewable. Do not merge or deploy until the relevant automated and deployed-client checks pass.


## Current sponsor-management implementation boundary

The current implementation adds a private administrator-only sponsor register at `/admin/sponsors`. Administrators can record the sponsor name, contact details, website/logo URLs, description, placement dates, status, agreed amount, currency, bank-transfer status/reference, and private notes. A payment marked as received is timestamped by the server. Creation is recorded in the existing append-only administrator audit log.

Sponsorship payments are made directly to the CathoScroll bank account and reconciled manually. The application does not collect bank details, initiate transfers, or integrate a payment provider. Sponsor records and campaigns are private. Campaign creation, approval, weighted delivery, targeting, frequency caps and aggregate performance reporting are now implemented; sponsor self-service accounts, campaign editing, invoices and billing remain future work.


## Bounded feed ranking work

The Top Comments selector first materializes at most the newest 5,000 eligible root comments from its 90-day window, using the existing partial index on visible top-level comment creation time. Like/reply aggregation and ranking then run only across that bounded candidate set. The endpoint retains its shared 30-second cache. This avoids a full 90-day engagement aggregation scan as comment volume grows; if the candidate pool regularly reaches its cap, the next scaling step is a maintained engagement-counter table rather than increasing the limit without bounds.
