# Feed analytics and community cards

**Status:** Feed telemetry, comment cards and admin analytics are deployed. Recommendation personalisation explicitly enables Service improvement analytics and uses the eligible feed and Top Comments activity signals recorded after consent. The analytics choice remains locked while personalisation is enabled; Sponsor measurement is separate. See `docs/analytics-data-protection-impact-assessment.md` for the provisional DPIA and outstanding legal/controller actions.

This document records the implementation that needs to be maintained. The product decisions and future sponsorship/quiz roadmap remain in `docs/feed-experience-and-analytics.md`; database and application security controls remain in `docs/security-hardening.md`.

## Feed event collection

Signed-in topic and Top Comments analytics remain account-linked and use their authenticated ingestion routes. Signed-out topic and Top Comments events use a separate bounded endpoint and are stored only as UTC daily entity aggregates. The two paths never share account-linked raw event tables. Both web and native use the same feed components; native anonymous events are sent to the configured CathoScroll API origin rather than the Capacitor local origin. This does not change TopicCard appearance, five-slide flow, swipe directions, likes, bookmarks, comments, progress writes or topic ordering.

Signed-out visitors are included in CathoScroll's first-party aggregate topic/comment pipeline by default, even when they decline optional account-linked analytics. A simple free objection is available in Manage choices. Vercel Web Analytics and Speed Insights load only when Service improvement analytics is enabled. When a visitor separately enables Service improvement analytics, Vercel Web Analytics uses a short-lived request-derived visitor hash and documents that it is discarded after 24 hours. Its data points may include timestamps, URLs, referrers, filtered query parameters, approximate geolocation and device/browser information. CathoScroll replaces topic, category and search identifiers with generic route labels and removes query strings and fragments. The site's strict-origin Referrer-Policy limits browser-supplied referrer data to the referring origin. Speed Insights uses the same URL minimisation; Vercel describes its performance data points as anonymous and not designed to identify visitors or reconstruct browsing sessions. Provider streams remain separate from CathoScroll's first-party Admin Analytics event tables.

The signed-out first-party path records only daily aggregates by topic/comment entity. It stores no account ID, raw session ID, persistent visitor ID, device fingerprint or cross-visit profile. Event UUID receipts are retained for 30 days for deduplication; daily aggregates contain counts for impressions, viewability, active duration, skips, completions and comment opens. It does not calculate anonymous unique people or sessions. Entity-level counts can still reveal that a specific topic/comment was viewed on a given day, and the context of a Catholic learning service may be sensitive. This architecture reduces direct attribution but is not a legal conclusion that all surrounding request/log data is anonymous. The controller must complete the Article 6/Article 9, PECR and infrastructure-log review before treating the processing as legally cleared.

Signed-in topic and comment events are account-linked personal data. They support Service improvement analytics and, while personalisation is enabled, the user's private recommendation profile. The personalisation opt-in also enables Service improvement analytics and the analytics control is locked until personalisation is withdrawn. Activity may reveal religious or philosophical interests; the controller must document the Article 6 basis, any applicable Article 9 condition, and PECR storage/access requirements.

A viewable impression requires at least 50% of the feed container to remain visible for one continuous second. Active duration is counted only while the document is visible and the feed container is viewable. Client timestamps are not accepted; server receipt time is authoritative.

The authenticated pipeline consists of:
- `catho_private.feed_analytics_events`: private raw events.
- `catho_private.feed_analytics_event_limits`: database-enforced per-user event counter.
- `POST /api/analytics/feed-events` and `public.record_feed_analytics_events(jsonb)`: bounded ingestion.

Limits are 50 events and 16 KiB per request, 120 submitted events per user per minute at the database layer, plus the shared API rate limit. Event IDs are unique per user for idempotent retries. Raw rows are retained for 180 days; a bounded cleanup job runs every 15 minutes and removes at most 5,000 expired rows per run. `catho_private.feed_analytics_daily` stores user-free per-topic/day totals and is refreshed every five minutes from the raw event window. `catho_private.feed_analytics_daily_viewers` stores a restricted user/topic/day deduplication bridge so distinct viewers remain exact across multiple days; it is pruned in bounded batches on the same 180-day schedule. The daily aggregate table contains no user or session identifiers and is retained beyond raw-event deletion.

The signed-out aggregate queue is not gated by Service improvement consent. It contains event UUIDs, entity IDs and bounded event metrics only; it carries no account, visitor or session identifier and sends no account cookies or bearer token. Website events remain in memory; native events use a bounded seven-day app-private outbox. Users can object through Manage choices, which stops new event creation and clears pending rows. Signed-in topic analytics queues remain account-scoped and consent-gated. Topic visit/completion deduplication also lives in the active analytics client session so conditional interstitial rendering cannot reset return-visit attribution. It retries on reconnect and page lifecycle changes while the process remains active. Native clients use the canonical site API with the current Supabase bearer token. This best-effort analytics queue is separate from the durable offline activity outbox and must never block learning actions.

## Top-comment feed card

The shared feed inserts a community comment interstitial after approximately five topic advances when eligible comments exist. It contains one to five top-level comments. Horizontal swipes and controls move between comments; vertical swipes continue the topic feed. Opening a comment takes the user to its original topic and targets the comment anchor. The same feed core is used by web and native applications.

The server selector requires a visible top-level comment on a published topic and category, non-empty text, age no greater than 90 days, and at least three combined likes and distinct reply authors, including at least two likes or one distinct reply author. Deleted comments and deleted replies do not contribute. Replies are never promoted. Ranking weights total and recent engagement with age decay; pinned comments receive no eligibility bypass or ranking override.

The selector is `public.get_top_feed_comments(integer, integer)`, executable only by `service_role`. Public clients use `GET /api/content/top-comments?offset=0&limit=100`, which applies a shared trusted-IP rate limit, validates the response and returns an explicit public-field allowlist. Pages are capped at 100 rows and the selector is bounded to the newest 5,000 eligible root comments in its 90-day candidate window. It does not return author IDs, emails, profile bios, moderation notes or raw events. The shared response cache is 30 seconds with a 30-second stale-while-revalidate window.

Top Comments groups contain up to five comments and are inserted every five topic advances. Each selected group reserves its comment IDs in the active feed session before display, so an interrupted group is not selected again as a fresh group. The client fetches additional pages as unseen inventory runs low; there is no five-comment total session cap. Previously inserted groups remain available through back-navigation. Once a group is exhausted or skipped, it is removed from the queue; its reserved IDs remain seen for the rest of the session, so cycling the feed cannot replay it. Seen-state is not persisted across sessions/devices. Inventory refreshes on mount, reconnect and foreground return. No persistent offline comment cache was added.

## Admin topic and category analytics

Administrators can open:
- `/topic/[slug]/analytics`
- `/categories/[category]/analytics`

The contextual **View Analytics** action is shown beside topic actions and on category pages only when the current administrator session passes the existing administrator-role check. Both analytics routes independently call `requireAdminPage()`, apply a per-admin shared rate limit and are marked noindex. Non-admins cannot use the aggregate RPC through the Data API.

`public.get_admin_content_analytics(text,text,timestamptz,timestamptz)` serves event totals, daily series and category top-topic impression counts from indexed daily aggregates, combining raw events only for partial UTC-day boundaries and session-depth calculations. This keeps dashboard work proportional to active content/day rows rather than every event. It is owned by `postgres`, uses `SECURITY DEFINER` with an empty search path, and is executable only by `service_role`. It returns aggregate counts and daily series only; it never returns user IDs, session IDs, comment text or raw events. The date window is validated and capped at 180 days.

Available feed metrics:
- Impressions and viewable impressions.
- Distinct signed-in viewers.
- Total active reading time and average active time per viewable impression.
- Early skip rate (skips divided by impressions).
- Average slide depth, calculated from the deepest slide reached per signed-in user/session/topic impression rather than averaging every swipe event.
- Completion event count, completion rate (completions divided by impressions), and average completion percentage derived from per-impression maximum slide depth.
- Return visits.
- Daily impressions and viewable impressions chart.
- Category-only topic coverage (total, published and unpublished topics) and the five most engaged published topics in the selected period, with links to their individual analytics.

Existing interaction records are displayed separately, with selected-period and lifetime totals for likes, bookmarks, top-level comments, replies, comment likes and completed topics. These older records can be counted historically; they are not treated as impressions or reading-time proxies.

The dashboard derives the earliest available event date from the retained raw-event table rather than assuming the database migration date equals the application rollout date. Earlier impressions, skip rates and reading duration cannot be reconstructed. If no telemetry is retained for the content, event metrics display as unavailable and the chart displays an explicit empty state rather than misleading zeros. If events exist elsewhere but not for this content, the page explains that no content-specific events are retained. Raw feed telemetry is only available within the 180-day retention window.

The dashboard uses the existing CathoScroll `Card`, `Badge` and `Button` components, existing design tokens, responsive page container, typography and purple accent. It does not introduce a separate charting dependency or a new visual system.

## Recommendation weighting

The existing category round-robin recommendation RPC now incorporates private feed telemetry when it creates a new cursor. Existing progress, bookmarks, likes and comments remain strong preference signals. Telemetry is limited to the previous 90 days and uses a 30-day half-life.

Per-topic telemetry contributions are bounded: viewable impressions +0.40 (maximum +1.20); active time +0.25 per minute (maximum +1.50); slide-depth events up to +0.50 each (maximum +1.50); completions +2.50 (maximum +3.00); return visits +0.75 (maximum +1.50). Early skips contribute -1.50 each (maximum -3.00), but only after skips occur in at least two distinct feed sessions for the same topic. The final per-topic score is clamped to -4 through +6.

The private `catho_private.get_user_feed_preference_signals(uuid)` helper checks that the requested account matches `auth.uid()`, runs as postgres with an empty search path, and is executable only by authenticated users. It returns category-level scores only. Raw event table access remains denied. A partial `(user_id, received_at DESC)` index supports the bounded per-account lookup.

The recommendation RPC combines category telemetry scores with the existing explicit learning signals, applies `1 + sqrt(max(score, 0))`, and retains a minimum category weight of 1. Negative signals can temper an existing preference but do not remove baseline exploration. Scores are embedded in the feed cursor, so subsequent pages use the same preference snapshot and keep pagination deterministic. The existing weighted round-robin and category-streak protection are unchanged.

## Database and security verification

Production Supabase changes for this work are additive. The canonical fresh-project schema is maintained in `docs/cathoscroll-database-bootstrap.sql`; do not create separate repository migration files for each implementation phase. The earlier broad analytics `(user_id, received_at)` index was removed while unused. Recommendation weighting now adds a purpose-built partial `(user_id, received_at DESC)` index covering only the feed signal event types used by its 90-day per-account lookup.

Verified:
- Authenticated analytics ingestion, duplicate-event idempotency, invalid metadata rejection and database rate-limit response in rollback-only smoke tests.
- Raw event and aggregate table access is denied to authenticated and service-role clients; only the validated ingestion RPC is granted to authenticated users. The daily-viewer bridge is private and has no client grants.
- Retention scheduling is active; raw events and daily-viewer bridge rows are pruned in bounded batches, and the pruning function is not executable by authenticated users. The user-free daily aggregate table survives raw-event deletion.
- Top-comment selector permissions: anon/authenticated denied; service_role allowed. Function owner is postgres, SECURITY DEFINER and empty search path.
- Top-comment fixtures: engagement threshold, five-result cap, 90-day cutoff, unpublished content exclusion, deleted comment exclusion, reply exclusion, recency ranking and no user IDs.
- Analytics aggregate fixtures: all feed metrics and daily series matched expected values; category aggregation across multiple topics worked; an empty selected period after prior telemetry returned zero counts while retaining the telemetry-present marker; ranges over 180 days were rejected; aggregate payload contained no user identifier. Rollback left zero test events.
- Analytics aggregate RPC permissions: service_role allowed; anon/authenticated denied. Function owner is postgres, SECURITY DEFINER and empty search path.
- The six comment-helper tests and four analytics-helper tests in `tests/feed-comments.test.mjs` and `tests/content-analytics.test.mjs` ran as part of the repository test suite. The current source-check workflow passed unit tests, ESLint, TypeScript and the Next.js production build. The pure comment helper also passed a strict standalone TypeScript check.

Recommendation smoke tests used rollback-only fixtures to verify per-signal caps, the 90-day window, positive completion/viewability weighting, skip suppression within one session, negative weighting only across two distinct sessions, category cursor weighting and denial of cross-account access. Both synthetic analytics events and the temporary progress row were rolled back. The recommendation helper is postgres-owned, SECURITY DEFINER with an empty search path, executable by authenticated users only, and cannot read arbitrary account data. The new partial per-user/time index is not flagged as unused by the performance advisor.\n\nSupabase advisors did not identify the new admin aggregate function as publicly executable. Existing project-wide findings remain: private/internal RLS tables without policies, existing public SECURITY DEFINER functions intentionally callable by app roles, and leaked-password protection disabled. The performance advisor reports 24 unused indexes elsewhere in the existing project; the new recommendation index and remaining feed-analytics indexes are not flagged. These existing project findings are not silently treated as fixed by this work.

## Before merge/release

- Re-run unit tests, ESLint, TypeScript checks and the Next.js production build after any further code changes; these passed on the current combined head.
- Linux x64, Windows x64, Android release APK and macOS Universal packaging all passed on the earlier combined head. A later source-only card-surface adjustment passed the source/test/lint/type/build job; its platform matrix was cancelled by workflow supersession and has been queued for a fresh run.
- The production deployment containing consolidated PR #25 is marked Ready on 20 November 2026. Complete the manual route, admin/non-admin and responsive browser review against production; automated deployment readiness does not replace this acceptance check. The repository-wide Prettier check is not a merge gate because it reports 130 existing formatting failures in unrelated files.
- Verify analytics API and aggregate pages in a deployed browser session with an administrator and a non-admin account.
- Verify native analytics ingestion and the comment card in Android and Electron builds.
- Exercise comment gestures, discussion deep links, pagination boundaries, account switching and moderation refresh.
- Run category aggregation with multiple topic fixtures and inspect query plans with representative event volume.
- Sponsor campaign delivery and reporting are implemented but remain inventory-empty in production until real sponsors and approved campaigns exist. Quiz cards remain out of scope.


## Sponsor accounts and organisation permissions

The sponsor register at `/admin/sponsors` is private. Administrators can link an existing Supabase Auth account to a sponsor by exact email, assign owner/manager/analyst roles, and suspend, reactivate or revoke access. Account lookup returns only a user UUID through an admin-only database function; it does not enumerate users, create Auth accounts, send invitations or change email verification. The database prevents the last active owner from being suspended or revoked.

The sponsor portal is `/sponsor`. Owners and managers can submit campaign creative and edit draft, pending-approval or rejected submissions. Analysts are read-only. Sponsor users see only their organisation's campaigns, aggregate metrics, invoices and bank-transfer records. They cannot set paid delivery weight or caps, approve their own campaigns, edit approved/paused campaigns or access raw user-level events. Campaign changes require administrator approval.

## Invoice and bank-transfer reconciliation

Sponsor payments remain direct bank transfers outside CathoScroll. Administrators create and issue invoices from the sponsor management page, then record the actual amount received after checking the bank statement. The private ledger supports partial payments, outstanding balances, optional unique bank-statement transaction IDs, duplicate protection and refunds linked to original payments. Overpayments and over-refunds are rejected. Invoice currency must match the sponsor agreement.

Sponsor payment eligibility is recalculated from the agreed amount and all outstanding issued invoices. Creating an invoice returns the sponsor to pending payment status; fully reconciling all invoices and the agreed amount sets payment status to received. The former direct **Mark received** override is disabled. The app does not store bank account details, initiate transfers or use a payment processor. CSV statement imports, automatic matching and formal tax-compliant invoice PDF/email delivery remain future work.


## Daily analytics rollups and long-term query scaling

The analytics pipeline now maintains two additional private tables:

- `catho_private.feed_analytics_daily`: one row per UTC day and topic, containing impressions, viewable impressions, active duration, skips, completions and return visits. It contains no user IDs, session IDs or raw metadata.
- `catho_private.feed_analytics_daily_viewers`: one row per UTC day/topic/user for exact distinct-viewer calculations across multi-day ranges. It is private, has no client grants and is retained for the same 180-day window as raw events.

`catho_private.refresh_feed_analytics_daily(2)` recomputes today and the preceding two UTC days, using idempotent upserts for totals and rebuilding the bounded viewer bridge. It runs every five minutes. Recomputing the rolling window makes retries safe and captures events that arrive after a previous refresh. Admin aggregate queries use daily rows for complete days and raw events for partial-day boundaries; session-depth calculations remain based on raw events because they require per-session maxima. Category top-topic impression ranking also uses the daily table.

The 180-day raw-event and viewer-bridge retention job runs every 15 minutes. Both raw events and viewer rows are deleted in bounded batches of at most 5,000 per invocation. User-free daily totals are retained after raw data expires, allowing historical trend preservation without retaining user-level analytics indefinitely. The admin UI's supported query window remains capped at 180 days.

The raw event table is deliberately not partitioned yet. Its production size is currently very small, and partitioning it would require changing the current per-user event-ID uniqueness/idempotency key. Revisit monthly partitioning when measured raw-event volume or vacuum/retention timings justify it; preserve idempotency with a separate event-key ledger or a composite partition-aware key before doing so. Do not introduce partitioning speculatively.


## Sponsor campaign delivery and reporting

Sponsor campaigns are stored in `public.sponsor_campaigns` with RLS enabled. The service role has SELECT-only access for the admin inventory; direct INSERT/UPDATE/DELETE are revoked. Campaign creation and state transitions are performed through administrator-verified, postgres-owned SECURITY DEFINER RPCs. Approval requires an active/scheduled sponsor with payment reconciled as received or explicitly not required. The sponsor payment itself remains a direct bank transfer outside CathoScroll.

Weighted delivery is handled by `public.get_weighted_sponsor_campaigns`, which is service-role-only. It locks the requesting user's delivery transaction and the selected campaign rows, applies sponsor and campaign date/status/payment/category/topic eligibility, daily and lifetime caps, a per-user 24-hour cap based on viewable impressions (so prefetches do not consume the user's exposure allowance), and a lifetime served cap, then chooses campaigns using weighted random selection. It reserves up to five unique campaigns and records a served event before returning only public creative fields. Organic recommendation ranking is not modified.

`catho_private.sponsor_campaign_events` stores served, viewable-impression and click events with per-event idempotency and one-viewable/one-click-per-campaign/placement-session unique indexes. Each card placement gets a new placement/session UUID, while returning to the same card reuses its original ID. The event API derives the actor from the authenticated request, rate limits writes, and the database rejects viewability/clicks that do not correspond to a served campaign in the same placement session. Clicks additionally require a recorded viewable impression.

`catho_private.sponsor_campaign_daily` stores user-free per-campaign/day served, viewable and click counts. The administrator campaign page reads 30-day metrics through `public.get_admin_sponsor_campaign_analytics`, an admin-verified, aggregate-only RPC. `catho_private.sponsor_campaign_user_frequency` stores the minimum per-user/campaign counters required to enforce frequency limits. Raw events are pruned in bounded batches after 180 days; frequency rows are removed in bounded batches after a campaign has ended for 180 days. The retention job also marks expired approved/paused campaigns completed, including campaigns whose sponsor has ended. Daily campaign totals contain no user IDs and remain available for historical reporting.

The feed inserts Top Comments every five topic advances and sponsor placements every ten topic advances, on independent schedules. If both are due at the tenth-topic boundary, Top Comments appears first and the sponsored card follows before the next topic. A missing inventory item suppresses only that card. A sponsor card can show up to five campaign positions. Campaign delivery is only requested for authenticated users in this release. Anonymous visitor frequency caps, bank statement imports, automatic matching and invoice PDF/email delivery remain out of scope.


## Unified Admin Analytics hub and Top Comments exposure

The central administrator analytics page is `/admin/analytics`, linked from the shared Admin navigation. It provides an overall view and date-window navigation across categories, topics, sponsors and comments. Category and topic drill-downs reuse the existing `/categories/[category]/analytics` and `/topic/[slug]/analytics` pages; sponsor and comment drill-downs live under `/admin/analytics/sponsors/[id]` and `/admin/analytics/comments/[id]`. All routes independently require the existing administrator-role check, apply the shared analytics read rate limit and are marked noindex.

The overview keeps the three measurement streams distinct:
- Topic feed: existing topic impressions, viewable impressions, active reading time, skips and completions from `feed_analytics_daily`.
- Sponsor delivery: served, viewable and click totals from the existing sponsor campaign delivery aggregates. These are not duplicated into organic feed analytics.
- Top Comments: card impressions, viewable impressions, active duration, early skips, meaningful-view completions and discussion opens from the separate feed-card analytics aggregates.

The overall placement total is a simple sum of topic impressions, sponsor served deliveries and Top Comments card impressions. The hub also plots the daily trend for each stream separately and calculates topic viewability/completion/skip rates, sponsor viewability/click-through, comment-card viewability/active time/open rate, distinct signed-in viewers per stream and deduplicated overall signed-in feed viewers. It includes topic likes, bookmarks, completed topics, new comments, replies and comment likes as separate interaction totals. It is explicitly not a unique-user count because the three event streams have different measurement semantics. Community likes and replies remain separate interaction counts and are never counted as feed exposure. Top Comments does not emit save, share or like events into this exposure pipeline.

### Top Comments event collection

- `catho_private.feed_card_analytics_events`: private, idempotent raw events keyed by account and event UUID.
- `catho_private.feed_card_analytics_event_limits`: database-enforced per-account event counter.
- `catho_private.feed_card_analytics_daily`: account-free daily card aggregates.
- `catho_private.feed_card_analytics_daily_viewers`: private per-day distinct-viewer bridge.

The authenticated `POST /api/analytics/feed-card-events` endpoint validates same-origin/native requests, requires a signed-in account, accepts at most 50 events and 16 KiB per request, applies the shared per-user rate limit, and calls `public.record_feed_card_analytics_events(jsonb)`. The database RPC independently validates event IDs, session IDs, event types, card type, card ID, duration and metadata size, applies a 120-event/minute per-account limit, and deduplicates retries by (user,event_id). Raw event rows are private and are not readable by app roles. The distinct-viewer bridge is also private and is pruned after 180 days; daily aggregate counts remain without retaining account identifiers.

For the current Top Comments renderer, a card impression is recorded when a signed-in user enters that comment card. A viewable impression requires at least 50% of the comment content to remain visible for one continuous second. Active duration is emitted in bounded five-second increments only while the document is visible and the content is viewable; a final partial interval is recorded when the card leaves. Leaving before three seconds of active viewing is classified as an early skip; three seconds or more is a meaningful-view completion. Opening the discussion is recorded separately. The website keeps an account-scoped in-memory queue capped at 200 events. Android and Electron additionally persist topic/comment events in the encrypted private activity database, capped at 2,000 per stream and seven days, uploaded in batches of up to 50 and removed only after server acknowledgement. Account queues are cleared on sign-out/account change. Analytics are best-effort and do not block feed navigation.

The rollup job runs every five minutes. Raw events are pruned in bounded batches every fifteen minutes after 180 days; daily aggregates remain available. The sponsor stream remains the source of truth for sponsor delivery and click analytics. No comment text, author identifiers, profile details or raw user/session identifiers are included in the dashboard payload.


## 8. Anonymous first-party analytics and signed-out sponsorship

The signed-out topic and Top Comments path posts event UUID, entity type/ID and bounded event metrics to the anonymous analytics endpoint. The server checks same-origin/native requests, bounds request size and batch length, applies rate limiting, and calls a service-role-only database function. The database validates event types and IDs against published topics and available top-level comments, caps active-duration values, deduplicates receipts for 30 days and writes UTC daily entity aggregates without account IDs, raw session IDs or persistent visitor IDs. The website holds a bounded in-memory queue. Native apps persist anonymous event UUIDs, public topic/comment IDs, event types and capped durations in app-private SQLite, with a 2,000-event cap and seven-day expiry. The native outbox retries in batches of 40 on reconnect/foreground and deletes rows only after server acknowledgement. The anonymous aggregate stream is on by default under the PECR Schedule A1 statistical-purposes exception only if the controller confirms every condition: sole service-improvement statistics purpose, clear and comprehensive notice, aggregate results that cannot identify people, no individual monitoring or onward use, and a simple free objection. The Manage choices control provides that objection and clears pending local rows. This is not a legal sign-off; the controller must document the Article 6 and PECR assessment before release.

Signed-out sponsor selection and event recording use dedicated service-role-only database functions and separate daily campaign aggregates. Failed sponsor event sends are retried in a bounded in-memory queue on reconnect/visibility changes; the queue is not persisted because the session token must remain ephemeral. A queued anonymous placement remains anonymous if the visitor signs in before the retry: the event route uses the placement key to select the anonymous recorder, which still validates the original session hash and served placement. Sponsor event attribution is tied to the exact topic placement as well as the hashed page-memory session, so a later placement cannot validate a click for an earlier one. A random session token is held only in page memory; its SHA-256 hash is stored for session-frequency control. Raw anonymous sponsor event and session-frequency rows are pruned after the 30-day retention threshold by a 15-minute cleanup job that deletes up to 5,000 expired rows per table per run. Campaign approval, sponsor/payment status, dates, category/topic targeting, weighted pacing and daily/total caps remain enforced. Sponsor portal and admin sponsor reporting show signed-in and anonymous campaign counts separately; CTR is calculated from the combined viewable/click totals and labelled accordingly.

The Admin Analytics overview, category/topic pages, sponsor/comment detail pages and campaign management pages now show signed-in and anonymous event counts separately. Signed-in unique viewers remain account-only; anonymous unique people/sessions are not calculated. The canonical emergency bootstrap contains the anonymous tables, functions, grants and retention job. No standalone migration file is maintained; apply changes directly to Supabase and reconcile the bootstrap.

The shared topic viewer, TopCommentFeedCard and SponsorFeedCard are used by web and native. Native anonymous analytics uses the configured CathoScroll API origin; native sponsor requests already use the configured API base URL. The implementation still requires automated CI and deployed web/native acceptance checks before release.

This is a technical implementation description, not a legal conclusion. Topic/comment context can still reveal or permit inferences about religious or philosophical beliefs. The controller must complete the Article 6 assessment, obtain advice on Article 9 applicability/condition, and review PECR, hosting logs and provider/transfer terms before treating the processing as legally cleared.


Native durability: the same encrypted private outbox also persists signed-in sponsor viewability/click events in a separate stream. Anonymous sponsor session tokens and their retry queue remain memory-only; anonymous topic/comment events use the separate anonymous outbox described above.
