# Feed Experience, Sponsorships, and Analytics

## Product constraints

- Existing topic cards and their five-slide topic-reading experience remain the primary feed experience.
- Do not redesign or replace topic cards as part of feed diversification. Changes to topic ranking must preserve the current card UI and navigation.
- The website and native applications continue to share feed and topic presentation wherever the current architecture supports it.
- All individual learning and community features are free. The only paid commercial offering is business/organisation sponsorship.
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

## Unified feed architecture

The existing `TopicFeedCore` controller and server-ranked topic pagination remain the source of truth. Top Comments and sponsored placements are interstitial states attached to the topic boundary that introduced them; they do not create a second recommendation list or replace the topic cursor. Signed-out visitors and signed-in users with personalisation disabled use the site-wide analytics-ranked general feed. Signed-in users who explicitly enable personalisation use the separate account-aware recommendation service. Neither general-ranked mode is locally shuffled; the server's category-balanced order is preserved.

Each active feed session keeps its ordered topic snapshot, independent comment/sponsor cadence counters, reserved comment groups, sponsor placement results and sponsor placement IDs in memory. Comment groups and sponsor placements are keyed by the introducing topic ID. Forward navigation replays the same mapped card and the same active comment within its group; reverse navigation returns through the same card in reverse order, restoring the previous comment position. At a shared tenth-topic boundary the order is always Top Comments, Sponsored, then the next topic. A missing or ineligible placement is recorded as an empty result for that topic and omitted without a blank card or repeated request. A full page/app reload or account change starts a fresh mapping.

The existing topic viewer and interstitial cards use the same vertical gesture contract and shared `FeedInterstitialMotion`/`TopicCardLayout` primitives. Topic, comment, sponsor and sponsor-loading states therefore share gesture thresholds, animation timing, neutral progress-bar surround and card geometry. A sponsor due at the same boundary as Top Comments is prefetched while the comment card is being read. If the request is still pending when the user advances, a matching, navigable loading surface is shown; the request has an eight-second timeout and can be cancelled by moving backward or skipped by moving forward. Sponsor request generations prevent a late response from changing the active card after navigation or account changes.

Topic pagination starts before the final loaded entries. New pages append only unseen topic IDs; an in-flight page can satisfy a pending forward gesture exactly once. A reverse gesture cancels that pending advance. If a page fails, the existing topic remains visible and the user can retry; the feed never appends duplicate topics or changes already visited topic positions. Web server-prop updates and native background catalogue updates use the same deduplicating append rule and preserve the active topic.

Sponsor served events for signed-in placements are recorded by the authenticated delivery API. Viewable-impression and click events use the authenticated sponsor-events endpoint and a separate account-scoped local queue capped at 1,000 events; stable event IDs make retries idempotent. Signed-out sponsor placements use dedicated anonymous selection and event functions, a page-memory session token hashed in the database for frequency controls, and separate campaign daily aggregates. Raw anonymous event/frequency rows are pruned after 30 days. Anonymous topic/comment event batches use a bounded local browser/native queue for restart-safe retry; anonymous sponsor event retries remain memory-only so the sponsor session token is never persisted. Both paths enforce approval, payment status, dates, category/topic targeting, weighted pacing and daily/total caps. Sponsor/admin reporting displays signed-in and anonymous campaign counts separately, with combined CTR labelled. These paid-delivery signals never feed organic topic ranking.

Sponsor selection still uses the existing server-side weighted fair-queue allocator. Each placement selects one campaign, records a served event before returning creative, and retains the same placement/session ID when revisited. Only a qualifying viewable impression affects the rolling delivery ratio. Clicks are accepted only after a viewable impression, and sponsor analytics remain separate from organic recommendation signals.

## Sponsorship cards

Each sponsor placement contains one selected campaign. The selector must not bundle every eligible campaign into one carousel: doing so would make campaigns with different paid weights receive the same opportunity whenever the eligible pool is small. If no campaign is eligible for the current topic, the sponsor card is omitted.

Sponsors are selected from an approved, active campaign pool. Each campaign has a sponsor, creative, destination URL, schedule, eligible categories or topics, paid weight, frequency caps, and status. All outbound links are validated and opened safely. Every placement is labelled as sponsorship.

### Weighted allocation

Paid weight controls a sponsor's proportional share of eligible sponsor impressions. For example, weights 2:1 produce an expected allocation of roughly two impressions to the first sponsor for every one to the second across a sufficiently large sample. This is rolling weighted fair-queue pacing, not a promise that every individual three-slot card contains exactly two and one.

The scheduler uses viewable-impression pacing over a rolling 30-day window. For each eligible campaign it compares `viewable_impressions / placement_weight` and selects the least-delivered campaign for the next single-campaign placement, randomising ties. This is weighted fair queuing: equal weights converge toward equal viewable impressions, while a 2:1 weight pair converges toward a 2:1 viewable-impression ratio. Served-but-never-viewed placements do not improve a campaign's delivery ratio. A campaign with no viewable impressions is treated as under-delivered. The eligible comparison set is recalculated for each matching user/category/topic opportunity, so campaigns that are not eligible for a slot do not distort its allocation.

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

There is no public fixed sponsorship price or automatic subscription. Sponsor amounts, campaign scope, dates, and any delivery commitments are agreed individually in writing and recorded in the sponsor invoice/workflow. Campaign weight and eligibility remain administrator-controlled and are never trusted from browser input.

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

The existing weighted-category RPC has been extended rather than replaced. It uses completed topics, bookmarks, likes, comments and signed-in feed telemetry as recommendation signals only when the account has explicitly enabled personalisation. Without consent, it does not read or aggregate those account-history signals: all category weights remain neutral and completed-topic history is not used to suppress recommendations. Category weights are frozen into the cursor so pagination remains deterministic; withdrawing consent also normalises already-issued cursors immediately.

Feed signals use a 90-day window and a 30-day half-life:
- Viewable impression: +0.40, capped at +1.20 per topic.
- Active reading: +0.25 per active minute, capped at +1.50 per topic.
- Slide depth: up to +0.50 per reached slide event, capped at +1.50 per topic.
- Completion: +2.50 per event, capped at +3.00 per topic.
- Return visit: +0.75 per event, capped at +1.50 per topic.
- Early skip: -1.50 per distinct feed session, capped at -3.00, and applied only after skips occur in at least two distinct sessions for that topic.

The explicit-action score is clamped between 0 and +8 per topic. Topic scores are aggregated by published category and combined with user-selected category interests. The category weight remains at least 1, using the square root of the non-negative combined preference score. The existing weighted round-robin selection and no-three-consecutive-category safeguard remain intact. Operational feed telemetry does not feed this score.

Recommendation profile signals are read from explicit account-action tables through private SECURITY DEFINER helpers that check `auth.uid()` against the requested account. They are invoked only when recommendation consent is enabled. Authenticated clients cannot read raw analytics rows or query another user's preference signals. A partial `(user_id, created_at)` index supports the bounded 180-day explicit-action lookup. The helper is invoked only when a new recommendation cursor is created, not for every page continuation. The profile refresher does not read operational analytics tables.

This is a first bounded scoring model, not a trained machine-learning system. It uses only explicit account actions after recommendation consent, caps repeated evidence, decays older actions and preserves cold-start diversity. Impressions, active duration, swipe depth, skips, return visits and Top Comments exposure remain operational analytics only. Topic freshness/quality scoring, additional explicit feedback and model evaluation against controlled experiments remain future work. Sponsor allocation stays separate from organic recommendations.

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

## Sponsor placement eligibility and retry behaviour

The feed distinguishes a successful empty campaign selection from a failed sponsor request. A successful empty response is cached for the topic/session so the same ineligible slot is not repeatedly requested. Authentication, HTTP, timeout and network failures are not cached as empty inventory; the topic's due sponsor slot remains eligible for a retry when revisited. A stale request cannot clear a newer in-flight retry.

The sponsor API can correctly return an empty campaign list when every campaign is ineligible because of date, approval/payment status, targeting, impression caps or per-user frequency caps. This is not a rendering failure: the feed skips the unavailable placement and continues without duplicating a topic. In particular, test campaigns with a five-serves-per-user-per-24-hour cap stop appearing after five successful served events until that rolling cap permits another serve.

## Future topic-card artwork

Public-domain painting backgrounds are a good visual direction, but should be a separate design change after feed navigation is stable.

- Curate at least three verified works per category; treat SDCason as a discovery source, not blanket proof of each image's rights. Record the original work, source URL, rights evidence and any required attribution in an asset manifest.
- Download and optimize approved assets into the project rather than hotlinking them at runtime. Generate responsive WebP/AVIF sizes and lazy-load artwork outside the active card.
- Assign artwork deterministically from the topic ID and category (for example, a stable hash modulo the curated category set). Do not reshuffle on component render, card revisit or feed pagination.
- Use a theme-aware contrast scrim and test text/buttons in both modes. The artwork belongs only behind the topic-card content surface; keep the progress-bar surround and shared interstitial geometry unchanged.
- Keep comment and sponsor cards on the same shared layout without forcing topic artwork onto them. They should remain visually related but retain their own content treatment.

## Unified feed manual acceptance matrix

Run these checks against a preview with test comments and at least two eligible sponsor campaigns. Use a fresh account/session for the first pass, then repeat after navigating away and back.

1. **Cadence, group size and ordering:** after five topic advances, Top Comments appears once and contains no more than five comments. With seven eligible unseen comments, the first group reserves five and leaves the remaining two eligible for a later group. At the shared tenth-topic boundary, the order is topic → Top Comments → Sponsored → next topic. No topic is duplicated to make room for either interstitial.
2. **Forward/reverse traversal:** verify topic A → comment group A → sponsor A → topic B, then reverse topic B → sponsor A → comment group A → topic A. Repeat several times without refreshing.
3. **Comment position:** move to the second or later comment in a group, leave the group, then revisit it in both directions. The same group and active comment position must return.
4. **Sponsor identity:** revisiting a sponsor placement must reuse the same campaign and placement/session ID. It must not select a new campaign or increment served count again.
5. **No eligible sponsor:** the due slot is omitted without a blank card, duplicated topic or stuck loading surface. The same empty result is reused for that topic during the session.
6. **Slow/failing sponsor request:** throttle the network, advance from Top Comments while prefetch is pending, then reverse and advance again. The loading card must remain swipeable, time out cleanly, and ignore late responses after the active entry changes.
7. **Pagination boundary:** throttle the next topic page and swipe forward at the final loaded topic. A successful page satisfies the pending gesture once; a reverse gesture cancels it. Duplicate IDs never append and prior topic positions remain unchanged.
8. **Comment inventory:** consume the first 100 comments, load another page, and verify IDs are deduplicated. Refresh the first page while a later page is loaded; cached groups and later inventory must not disappear unexpectedly.
9. **Refresh/account reset:** a full page/app reload or account change starts a fresh topic/interstitial mapping. Ordinary forward/reverse navigation and background inventory refresh do not.
10. **Sponsor analytics:** confirm one server-side served event per placement, one qualifying viewable impression, and a click only after a viewable impression. Revisit the same placement and verify event IDs/session IDs prevent double counting. Test offline queuing and stable-ID retry.
11. **Web/native data updates:** refresh server topic props on web and update the catalogue in the native shell while a user is on a topic or interstitial. The active entry and all earlier/later ordering must remain stable; only unseen topic IDs may append.

**Route round-trip:** open the original discussion from a comment card, then use browser Back to return to the feed. The same topic, comment group, active comment and sponsor placement should be restored; a full browser/app reload should start a new mapping. If the route remount loses the snapshot, add a root-level in-memory feed-session store before merging.

Do not mark the feed release-ready until this matrix passes on desktop web, mobile web and the native WebView, including an account switch and a forced refresh.

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

Implementation status on 18 November 2026:

1. **Feed/admin/comment/offline architecture review:** existing systems were inspected for this work; the offline activity architecture was preserved.
2. **Validated event schema, ingestion, deduplication and retention:** implemented; source tests and build checks are being rerun after the latest navigation and audit-policy changes, with deployed browser/native verification still outstanding.
3. **Topic interaction instrumentation:** implemented without changing the topic-card UI; deployed data collection begins when the combined release is deployed.
4. **Recommendation weighting and diversity safeguards:** first telemetry-weighted model implemented; quality/freshness scoring and measured experimentation remain future work.
5. **Top-comment feed cards and eligibility:** implemented, including topic-bound group caching, active-comment restoration and incremental inventory pagination; real inventory testing remains outstanding because production currently has no comments.
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
