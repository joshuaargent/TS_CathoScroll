# Feed analytics and community cards

**Status:** Feed telemetry, comment cards, admin analytics and the first telemetry-weighted recommendation model are implemented in the combined PR. Automated source checks pass; deployed browser/native verification remains outstanding.

This document records the implementation that needs to be maintained. The product decisions and future sponsorship/quiz roadmap remain in `docs/feed-experience-and-analytics.md`; database and application security controls remain in `docs/security-hardening.md`.

## Feed event collection

The existing topic swipe viewer records signed-in topic impressions, viewability-qualified impressions, active visible duration, early skips, slide depth, completion and return visits. The existing TopicCard appearance, five-slide flow, swipe directions, likes, bookmarks, comments, progress writes and topic ordering are unchanged.

A viewable impression requires at least 50% of the feed container to remain visible for one continuous second. Active duration is counted only while the document is visible and the feed container is viewable. Client timestamps are not accepted; server receipt time is authoritative.

The authenticated pipeline consists of:
- `catho_private.feed_analytics_events`: private raw events.
- `catho_private.feed_analytics_event_limits`: database-enforced per-user event counter.
- `POST /api/analytics/feed-events` and `public.record_feed_analytics_events(jsonb)`: bounded ingestion.

Limits are 50 events and 16 KiB per request, 120 submitted events per user per minute at the database layer, plus the shared API rate limit. Event IDs are unique per user for idempotent retries. Raw rows are retained for 180 days; a bounded cleanup job runs every 15 minutes and removes at most 5,000 expired rows per run. `catho_private.feed_analytics_daily` stores user-free per-topic/day totals and is refreshed every five minutes from the raw event window. `catho_private.feed_analytics_daily_viewers` stores a restricted user/topic/day deduplication bridge so distinct viewers remain exact across multiple days; it is pruned in bounded batches on the same 180-day schedule. The daily aggregate table contains no user or session identifiers and is retained beyond raw-event deletion.

The browser queue is localStorage-backed, namespaced per account and capped at 200 unacknowledged events. When full, it evicts the oldest events and retains the most recent activity so a long offline session does not stop recording new engagement. Topic visit/completion deduplication lives in the analytics client session so conditional interstitial rendering cannot reset return-visit attribution. It retries on reconnect and page lifecycle changes. Native clients use the canonical site API with the current Supabase bearer token. This best-effort analytics queue is separate from the durable offline activity outbox and must never block learning actions.

## Top-comment feed card

The shared feed inserts a community comment interstitial after approximately five topic advances when eligible comments exist. It contains one to five top-level comments. Horizontal swipes and controls move between comments; vertical swipes continue the topic feed. Opening a comment takes the user to its original topic and targets the comment anchor. The same feed core is used by web and native applications.

The server selector requires a visible top-level comment on a published topic and category, non-empty text, age no greater than 90 days, and at least three combined likes and distinct reply authors, including at least two likes or one distinct reply author. Deleted comments and deleted replies do not contribute. Replies are never promoted. Ranking weights total and recent engagement with age decay; pinned comments receive no eligibility bypass or ranking override.

The selector is `public.get_top_feed_comments(integer, integer)`, executable only by `service_role`. Public clients use `GET /api/content/top-comments?offset=0&limit=100`, which applies a shared trusted-IP rate limit, validates the response and returns an explicit public-field allowlist. Pages are capped at 100 rows and the selector is bounded to the newest 5,000 eligible root comments in its 90-day candidate window. It does not return author IDs, emails, profile bios, moderation notes or raw events. The shared response cache is 30 seconds with a 30-second stale-while-revalidate window.

Top Comments groups contain up to five comments and are inserted every five topic advances. Each selected group reserves its comment IDs in the active feed session before display, so an interrupted group is not selected again as a fresh group. The client fetches additional pages as unseen inventory runs low; there is no five-comment total session cap. Previously inserted groups remain available through back-navigation. Once a group is exhausted or skipped, it is removed from the queue; its reserved IDs remain seen for the rest of the session, so cycling the feed cannot replay it. Seen-state is not persisted across sessions/devices. Inventory refreshes on mount, reconnect and foreground return. No persistent offline comment cache was added.

## Admin topic and category analytics

Administrators can open:
- `/topic/[slug]/analytics`
- `/categories/[category]/analytics`

The contextual **View Analytics** action is shown beside topic actions and on category pages only when the current administrator session passes the existing admin/MFA check. Both analytics routes independently call `requireAdminPage()`, apply a per-admin shared rate limit and are marked noindex. Non-admins cannot use the aggregate RPC through the Data API.

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
- A later Vercel preview deployment is marked Ready after two earlier attempts hit the free-plan daily deployment quota. Complete the manual route, admin/non-admin and responsive browser review against that preview. The repository-wide Prettier check is not a merge gate because it reports 130 existing formatting failures in unrelated files.
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

Weighted delivery is handled by `public.get_weighted_sponsor_campaigns`, which is service-role-only. It locks the requesting user's delivery transaction and the selected campaign rows, applies sponsor and campaign date/status/payment/category/topic eligibility, daily and lifetime caps, per-user 24-hour and lifetime frequency caps, and chooses campaigns using weighted random selection. It reserves up to five unique campaigns and records a served event before returning only public creative fields. Organic recommendation ranking is not modified.

`catho_private.sponsor_campaign_events` stores served, viewable-impression and click events with per-event idempotency and one-viewable/one-click-per-campaign/placement-session unique indexes. Each card placement gets a new placement/session UUID, while returning to the same card reuses its original ID. The event API derives the actor from the authenticated request, rate limits writes, and the database rejects viewability/clicks that do not correspond to a served campaign in the same placement session. Clicks additionally require a recorded viewable impression.

`catho_private.sponsor_campaign_daily` stores user-free per-campaign/day served, viewable and click counts. The administrator campaign page reads 30-day metrics through `public.get_admin_sponsor_campaign_analytics`, an admin-verified, aggregate-only RPC. `catho_private.sponsor_campaign_user_frequency` stores the minimum per-user/campaign counters required to enforce frequency limits. Raw events are pruned in bounded batches after 180 days; frequency rows are removed in bounded batches after a campaign has ended for 180 days. The retention job also marks expired approved/paused campaigns completed, including campaigns whose sponsor has ended. Daily campaign totals contain no user IDs and remain available for historical reporting.

The feed inserts Top Comments every five topic advances and sponsor placements every ten topic advances, on independent schedules. If both are due at the tenth-topic boundary, Top Comments appears first and the sponsored card follows before the next topic. A missing inventory item suppresses only that card. A sponsor card can show up to five campaign positions. Campaign delivery is only requested for authenticated users in this release. Anonymous visitor frequency caps, bank statement imports, automatic matching and invoice PDF/email delivery remain out of scope.
