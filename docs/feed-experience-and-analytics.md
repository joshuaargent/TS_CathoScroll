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
- The schedules are independent. At the tenth-topic boundary, both are due: Top Comments appears first, followed by the sponsored card before the next topic. No topic advance is counted between them.
- Missing or ineligible inventory omits only that card; it does not change the other card type's cadence. No blank placeholders are inserted.

## Sponsorship cards

A sponsorship card contains up to five sponsor positions. It loops/rotates through eligible sponsors and only renders populated positions. If fewer than five sponsors are eligible, the card has fewer positions; if none are eligible, the card is omitted.

Sponsors are selected from an approved, active campaign pool. Each campaign has a sponsor, creative, destination URL, schedule, eligible categories or topics, paid weight, frequency caps, and status. All outbound links are validated and opened safely. Every placement is labelled as sponsorship.

### Weighted allocation

Paid weight controls a sponsor's proportional share of eligible sponsor impressions. For example, weights 2:1 produce an expected allocation of roughly two impressions to the first sponsor for every one to the second across a sufficiently large sample. This is probabilistic pacing, not a promise that every individual three-slot card contains exactly two and one.

The scheduler uses viewable-impression pacing over a rolling 30-day window. For each eligible campaign it compares `viewable_impressions / placement_weight` and selects the least-delivered campaign first, randomising ties. This is weighted fair queuing: equal weights converge toward equal viewable impressions, while a 2:1 weight pair converges toward a 2:1 viewable-impression ratio. Served-but-never-viewed placements do not improve a campaign's delivery ratio. A campaign with no viewable impressions is treated as under-delivered. The eligible comparison set is recalculated for each matching user/category/topic opportunity, so campaigns that are not eligible for a slot do not distort its allocation.

The scheduler must:
- Prioritise under-delivered campaigns using viewable impressions divided by paid placement weight.
- Enforce campaign start/end dates and active status.
- Apply per-user and global frequency caps.
- Avoid immediate repetition where alternatives exist.
- Keep category targeting and brand-suitability rules.
- Record served placements, viewable impressions, clicks, and cap/eligibility decisions separately.
- Use only the deduplicated `viewable_impression` event for pacing; served counts remain safeguards for caps and frequency limits.
- Never count a sponsor impression until the placement meets a defined viewability threshold.
- Keep sponsor events separate from organic topic recommendation signals.

A proposed commercial starting point is £25/month for one weight unit, with higher tiers buying proportionally more share of the eligible impression pool. This is a product/pricing proposal only; do not activate billing or promise guaranteed impressions until inventory, traffic, viewability, reporting, refunds, and payment integration are defined. Sponsor pricing and campaign weight must be controlled server-side, never trusted from browser input.

## Sponsor management and accounts

Administrators manage sponsor organisations and account membership at `/admin/sponsors`. They can link an existing CathoScroll Auth account by exact email, assign owner/manager/analyst roles, and suspend, reactivate or revoke access. Assignment does not create an Auth user, send an invitation, or change email verification. The account must already exist.

Sponsor representatives use `/sponsor`. Owners and managers can submit and edit draft, pending or rejected campaign submissions; analysts are read-only. Sponsor users see only their organisation's campaigns, aggregate performance, invoices and recorded payments. They never receive user identities, raw events, other sponsors' data or administrator tools. Approved and paused campaigns cannot be edited by sponsor users; creative changes require administrator review.

CathoScroll uses direct bank transfers, not in-app payment processing. Administrators issue invoices and record full/partial transfers against them, including bank reference/date and an optional unique statement transaction ID. Refunds are separate ledger entries. Campaign payment eligibility is derived from reconciled invoice balances and the agreed sponsor amount. Bank-statement import, automatic matching, tax-compliant PDF/email invoice delivery and payment-provider integration remain future work.

## Top-comment cards

A top-comment card contains up to five eligible top-level comments. Horizontal swipes move between comments inside the card; they do not immediately navigate away. Each comment shows its text, author, original topic, like count, reply count, and a clear action to open the original discussion. Tapping the comment or its discussion action opens the topic discussion focused on that comment.

Each group contains up to five comments and the progress indicator reflects the actual group size. No eligible unseen comments means no card. A comment is reserved as seen when its group is inserted, so navigating away or remounting the card cannot cause it to be selected again during the same feed session. There is no five-comment total session limit: the client requests further bounded pages as the unseen inventory runs low, and every five-topic boundary can receive a fresh group. The server ranks within a bounded pool of the newest 5,000 eligible root comments from the previous 90 days; pages contain at most 100 entries. Seen-state is session-memory only and resets when the account/feed session changes; persistent cross-session/device exclusion is not implied.

Only visible, non-deleted, non-empty top-level comments on published topics in published categories are eligible. Replies contribute to engagement but are not independently promoted. The initial server-side threshold is at least 3 combined likes and distinct reply authors, with at least 2 likes or 1 distinct reply author; counting distinct reply authors reduces the effect of repeated replies from one account. The selector considers comments from the previous 90 days. Ranking combines lifetime likes, distinct reply authors, activity in the previous 14 days, and a weekly age-decay factor; it is not lifetime-like ordering. The endpoint exposes a bounded offset/limit page and allowlists public fields. Pinned comments do not bypass the threshold or moderation filters. The client suppresses comments already viewed during the active in-memory feed session; persistent cross-session/device seen-state remains deferred.

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
6. **Sponsor organisations, accounts, campaign management, weighted delivery, reporting and reconciliation:** implemented in the draft PR and live database schema. Existing Auth users can be assigned sponsor roles; sponsor users can submit/edit eligible campaign submissions; admins control approval and delivery; invoices, partial bank transfers, duplicate transaction protection and refunds are recorded in an audited private ledger. Bank statement imports and formal invoice PDF/email delivery remain outstanding.
7. **Admin topic/category analytics and graphs:** implemented; admin/non-admin browser verification remains outstanding.
8. **Quiz entities, five-question feed cards, attempts and dedicated routes:** not started.
9. **Automated sponsor billing integrations:** deferred. Direct bank transfer and manual reconciliation are implemented; automatic bank matching and payment-provider processing are deliberately not included.

Keep future phases independently reviewable. Do not merge or deploy until the relevant automated and deployed-client checks pass.


## Current sponsor-management implementation boundary

The current implementation provides an administrator-only sponsor register and membership manager at `/admin/sponsors`, a sponsor-facing portal at `/sponsor`, and campaign administration at `/admin/sponsor-campaigns`. Admins can assign existing Auth accounts to sponsor organisations with owner, manager or analyst roles. Membership changes are audited; the database prevents suspension/revocation of the last active owner. No invitation is sent and email verification is not changed.

Sponsor users can submit campaigns for approval and edit only draft, pending or rejected submissions. Delivery weight and caps remain administrator-controlled. Campaigns require an active/scheduled sponsor, valid dates and targeting, and payment status `received` or `not_required` before delivery.

Direct bank transfers are recorded against issued invoices. The private ledger supports partial/full payments, duplicate transaction keys, outstanding balances and refunds. Payment status is derived from the agreed sponsor amount and all outstanding issued invoices; the old direct “mark received” override is disabled. No bank details or card data are stored, and the app does not initiate payments. The sponsor portal exposes only its organisation's aggregate campaign metrics, invoice balances and recorded transactions. Automatic bank-statement import/matching and tax-compliant invoice PDFs/email delivery remain future work.


## Bounded feed ranking work

The Top Comments selector first materializes at most the newest 5,000 eligible root comments from its 90-day window, using the existing partial index on visible top-level comment creation time. Like/reply aggregation and ranking then run only across that bounded candidate set. The endpoint retains its shared 30-second cache. This avoids a full 90-day engagement aggregation scan as comment volume grows; if the candidate pool regularly reaches its cap, the next scaling step is a maintained engagement-counter table rather than increasing the limit without bounds.
