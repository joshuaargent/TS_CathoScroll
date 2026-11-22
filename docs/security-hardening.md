# CathoScroll security hardening reference

**Updated:** 20 November 2026  
**Scope:** Website, API, Supabase database, moderation and native administrator access.

This is an operational reference, not an executable SQL script. The repository intentionally contains no Supabase migration files. `docs/cathoscroll-database-bootstrap.sql` is the single canonical SQL source for rebuilding the complete CathoScroll application schema on a fresh Supabase project.

## Database security

The live Supabase project has:

- Row Level Security enabled on every public table.
- Restricted grants for sensitive profile, comment and like data.
- No direct anonymous or authenticated SELECT access to comment content.
- No direct anonymous or authenticated SELECT access to private profile fields.
- Public profile reads restricted to explicitly public fields.
- Raw comment/topic liker identities restricted; public counts and the current viewer's like state are returned through bounded RPCs.
- Notification updates restricted to `read_at`; a database trigger prevents content/ownership changes, client-controlled timestamps and marking read notifications unread.
- Fixed `search_path` on privileged functions, explicit execution grants and private-schema placement for internal helpers.

Important RPCs include:

- `get_topic_comment_page`
- `get_topic_like_state`
- `get_public_profile_metrics`
- `get_my_recommendation_page`
- `is_cathoscroll_content_admin` (SECURITY INVOKER wrapper over a private SECURITY DEFINER helper)
- Owner-only administrator role and audit functions.

Private/internal tables intentionally have no direct API policies. Their access is through restricted server-side functions or triggers.

## Database-enforced mutation limits

| Operation | Limit |
|---|---:|
| Comment creation, replies and edits | 10 / 10 minutes, 40 / hour, 120 / 24 hours |
| Comment likes | 180 / hour |
| Topic likes | 180 / hour |
| Bookmark changes | 120 / hour |
| Progress changes | 1,000 / hour |
| Comment-ban appeals | 3 / 24 hours |
| Direct recommendation RPC | 30 / minute |

These checks run in PostgreSQL and therefore also protect direct Supabase clients that bypass Next.js routes.

## Shared API rate limiting

Server routes use a shared PostgreSQL counter rather than in-memory process state. Counters use atomic updates and HMAC-keyed identifiers; raw client IP addresses are not stored. IP limits use the Vercel-provided `x-real-ip` header only when running on Vercel.

- Public search: 180 / minute / IP.
- Public topic pagination: 120 / minute / IP.
- Feed and sitemap: 60 / minute / IP.
- Comment reports: database user limit plus IP abuse limit.
- Appeals: database daily limit plus user/IP cooldowns.
- Notifications: per-user read/write limits.
- Recommendations: per-user API limit plus the direct-RPC database limit.
- Administrator operations: stricter per-admin limits, with separate read and mutation policies.

API rate-limit responses include `Retry-After` where applicable.


## Offline activity sync protection

- Native activity uploads use an authenticated batch RPC with a maximum of 100
  ordered operations per request.
- A per-account Postgres counter limits all offline activity RPC operations to
  300 per minute, including attempts against unavailable topics.
- Existing per-action limits still apply to the underlying bookmark, like and
  progress writes. A rate-limited operation is deferred rather than discarded.
- Device sequence numbers, operation receipts, and a client-confirmed
  acknowledgement cursor make retries idempotent, including replay of a whole
  batch after a lost response.
- Acknowledged receipt and sequence rows are pruned when the client advances
  its acknowledgement cursor. Unacknowledged operations remain available.
- Activity and catalogue event histories are retained for approximately
  31 days. Scheduled cleanup jobs run every five minutes and every 15 minutes
  respectively.

## Feed analytics ingestion

- Signed-in feed telemetry is accepted only through POST /api/analytics/feed-events or the authenticated record_feed_analytics_events RPC.
- The database derives the actor from auth.uid(); clients cannot submit an arbitrary user ID.
- Raw event and rate-limit tables live in catho_private, have RLS enabled, and have no direct Data API grants for anon, authenticated, or service_role.
- The ingestion RPC validates event IDs, session IDs, published topic references, event types, metadata keys, metadata size, and batch bounds.
- Event IDs are unique per user, making retries idempotent.
- Each request is limited to 50 events and 16 KiB; database ingestion is limited to 120 submitted events per user per minute. The HTTP route also uses the shared PostgreSQL API rate limiter.
- Client telemetry is queued per signed-in account and does not share or block the durable offline activity outbox.
- Signed-in raw analytics events are retained for 180 days. A bounded database cleanup job runs every 15 minutes and removes at most 5,000 expired events per run. Admin reporting uses on-demand aggregate queries over opted-in account-linked events only.
- Signed-out visitors do not generate topic or Top Comments engagement events. No anonymous endpoint, aggregate table, receipt ledger or retry queue exists. Signed-in Service improvement and Sponsor measurement events are independently consent-gated and use account-scoped identifiers.
- Sponsor and administrator reporting must use server-side aggregate functions; raw events and individual user identities must never be exposed to sponsor accounts.

- `public.get_admin_content_analytics(text,text,timestamptz,timestamptz)` is an on-demand aggregate RPC for topic/category dashboards. It is owned by postgres, uses SECURITY DEFINER with an empty search path, validates entity and date-window inputs (maximum 180 days), and is executable only by service_role. It returns counts and daily buckets only, never user IDs, session IDs or raw event rows.
- The aggregate function also counts existing likes, bookmarks, visible top-level comments, visible replies and completed-topic records separately from feed telemetry. These historical interaction records are not used to infer impressions or reading time.
- The admin pages call the existing server-side administrator-role guard and apply a shared per-admin rate limit before invoking the aggregate RPC. The RPC is not directly executable by anon or authenticated roles.
- `public.get_top_feed_comments(integer, integer)` is a separate server-only selector. It is SECURITY DEFINER with an empty search path and executable only by service_role. The public endpoint accepts bounded offset/limit pagination (up to 100 rows per page), returns an explicit allowlist of public comment/author/topic fields, and never exposes user IDs, emails, profile bios, moderation notes or raw events. It excludes deleted/hidden comments, replies as candidates, and comments belonging to unpublished content.

## Recommendation telemetry access

The existing `public.get_my_recommendation_page(jsonb,integer)` remains SECURITY INVOKER and authenticated-only. On a new cursor it calls `catho_private.get_user_feed_preference_signals(uuid)`, a private SECURITY DEFINER helper owned by postgres with an empty search path. The helper rejects null or mismatched account IDs using `auth.uid()`, returns only category-level scores, and is executable by authenticated users only. The recommendation RPC calls it only when explicit personalisation consent is enabled. Legacy progress, bookmarks, likes, comments and feed telemetry are also gated by that consent; when disabled, category weights are neutral and completed-topic suppression is off. Withdrawing consent normalises active cursors. The helper does not grant access to raw analytics tables. The partial per-user/time index supports its 90-day scan.

## Comment invariants

Database triggers enforce:

- Caller owns the new comment; the author cannot be spoofed.
- The topic is published.
- A reply's parent exists, is in the same topic and is not deleted.
- Maximum reply depth is enforced independently of the UI.
- Content is non-empty and no longer than 2,000 characters.
- Ownership, topic, parent and moderation fields cannot be spoofed.
- Banned users cannot create or edit comments.
- Timestamps and edit state are server-controlled.

The website loads comments in 50-row cursor pages. Like counts and the current viewer's like state are aggregated in the same RPC. Pinned roots and reply ancestry are preserved.

## Profiles and bookmarks

- Public profile statistics are calculated by a bounded aggregate RPC instead of transferring full completion and comment histories to the application server.
- Public profile queries select explicit public fields.
- Bookmark pages use stable keyset pagination, 50 records per page, with associated topics loaded in bounded batches.
- Sitemap pages are checked against actual published-content counts before database work.

## Administrator security

- Administrator APIs and protected pages use server-side administrator checks.
- The owner alone can grant or revoke administrator roles.
- Moderation, role and security actions are written to an append-only audit table; only the owner can view the paginated audit log.
- CathoScroll does not implement multi-factor authentication, authenticator enrolment or authenticator challenges. Sign-in uses the existing email/password flow. Administrator access is controlled by the protected administrator-role table.

## API and browser protections

- JSON request bodies are bounded before parsing; limits vary by route.
- User-specific notification, recommendation and administrator responses use private/no-store caching.
- CSP is configured in report-only mode with a bounded, rate-limited report collector.
- HSTS and a restrictive Permissions Policy are configured.
- Obsolete `X-XSS-Protection` was removed.
- XML feeds and sitemaps retain escaping protections.

CSP enforcement and production response-header verification still require a successful deployed browser/preview check.

## Automated security checks

The repository has a recurring GitHub workflow for:

- `npm audit` on root and Electron dependency trees.
- CodeQL extended JavaScript/TypeScript analysis.
- Gitleaks full-history secret scanning.

The dependency tree retains a low-severity `deepmerge` advisory in the legacy Workbox build chain. npm's only suggested automatic remediation downgrades `next-pwa` to 3.1.5, which is a breaking change; that downgrade was rejected to preserve PWA/offline behaviour. Vulnerable `serialize-javascript`, `minimatch` and `uuid` transitive versions are pinned to patched releases through targeted package overrides. The dependency audit is configured to fail on moderate or higher findings in both lockfiles. The combined PR's first audit identified Next.js advisory `GHSA-mfr8-8qww-v76h` while the lockfile still resolved 16.4.3. Next.js, `@next/env` and all matching SWC platform packages were updated together to 16.4.5. The subsequent dependency audit passed with no moderate-or-higher findings in either dependency tree. Five low-severity findings remain in the root legacy Workbox/deepmerge chain; the only suggested automatic remediation downgrades `next-pwa` to 3.1.5 and remains rejected because it would break PWA/offline behaviour.

## Top-comment feed selection

The top-comment feed selector is a server-only database function. `public.get_top_feed_comments(integer, integer)` is `SECURITY DEFINER`, owned by `postgres`, pins `search_path = ''`, and schema-qualifies its table and built-in function references. Execution is revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` can execute it. Browser and native clients never call this RPC directly.

Clients use `GET /api/content/top-comments`. The route calls the RPC using the server-only service-role client and applies the shared trusted-IP database rate limiter at 120 requests per IP per minute. Native CORS is restricted to the application's allowlisted origins. Native fetches omit cookies and credentials.

The endpoint returns no more than five entries and validates every field before serialising an explicit allowlist. Returned data is limited to public comment text (maximum 600 characters), public author display name/username, topic/category context, timestamps, pinned state and aggregate like/reply counts. It does not return comment-author user IDs, emails, profile bios, report details, moderation notes, or raw analytics events. If the database response contains an unexpected field or invalid value, the route fails closed with a non-cacheable 503 rather than returning an unvalidated payload.

The selector excludes deleted/hidden comments, blank comments, replies, comments outside the 90-day window, and comments belonging to unpublished topics or categories. Existing ban moderation hides comments through `is_deleted = true`, which the selector excludes. The endpoint uses a 30-second shared cache and a 30-second stale-while-revalidate window; this bounds database load while limiting the time deleted content can remain in a cached response.

Comment inventory is fetched online but is not written to a persistent local cache or duplicated in the existing offline activity queue. Previously fetched comments can remain available in the current in-memory feed session; if no inventory has been loaded and the endpoint is unreachable, the interstitial is omitted without blocking the feed. Comment-card impression, viewability, active-time, skip/completion and open analytics are implemented only through the authenticated Service improvement pipeline for users who explicitly opt in. Signed-out visitors are not measured. Persistent cross-session seen-state is still not implemented.

## Validation and limitations

Rollback-only live-database tests exercised 1,001-comment pagination, cursor progression, reply ancestry, moderation/depth checks, notification column restrictions, recommendation limits, administrator-role RLS and audit-log immutability. Test fixtures were rolled back; no test comments, notifications or audit rows remain.

Not yet completed:

- Supabase Auth dashboard verification for password policy, CAPTCHA and provider rate limits.
- Leaked-password protection (available on Supabase Pro and above).
- Browser verification of CSP and deployed response headers against the current production deployment remains outstanding.
- Physical Android and Electron device regression tests.
- Disposable Supabase integration suite and independent penetration testing.
- Admin content-editor pagination; it currently loads catalogue data in batches.
- Long-term cached profile-stat summaries if activity volumes grow substantially.

The database hardening and its application compatibility changes in PR #7
were merged on 16 November 2026. The current `main` branch uses the bounded
comment-page and public-profile RPCs. Keep the production deployment aligned
with the merged `main` branch; do not deploy an older application build
against the hardened schema.


## Sponsor organisations and account membership

The sponsor register is administrator-only. `public.sponsors` has RLS enabled, no client-facing policies and direct table privileges revoked from `PUBLIC`, `anon` and `authenticated`. `public.sponsor_memberships` is also RLS-enabled; the service role has SELECT-only access and all writes go through audited RPCs. `catho_private.sponsor_member_audit` has RLS enabled and no direct table grants.

Administrators assign existing Auth accounts to sponsor organisations by exact email through `public.admin_find_sponsor_user_by_email` and `public.admin_add_sponsor_member`. The lookup returns only the matching user UUID, verifies the supplied actor against `public.admin_users`, and is executable only by `service_role`. Membership roles are `owner`, `manager` and `analyst`; statuses are `active`, `suspended` and `revoked`. `public.admin_set_sponsor_member_status` audits changes and prevents removal of the last active owner. `public.admin_set_sponsor_status` lets administrators pause/reactivate/complete an organisation and audits the change; non-active sponsors are excluded from campaign delivery. Sponsor representatives must already have a CathoScroll account; this flow does not create accounts, send invitations or alter email-verification settings.

Sponsor portal reads are server-side and filtered by the authenticated user's active memberships. `public.get_sponsor_campaign_analytics` and `public.get_sponsor_financials` verify membership independently. Sponsor users cannot access another organisation, admin routes, user-level analytics or raw campaign events. Owner/manager roles may submit and edit draft, pending-approval and rejected campaigns; analyst is read-only. Approved and paused campaigns cannot be edited by sponsor users.

## Sponsor invoice and payment reconciliation

`catho_private.sponsor_invoices` and `catho_private.sponsor_payment_transactions` are RLS-enabled private tables with no direct grants to `PUBLIC`, `anon`, `authenticated` or `service_role`. Financial reads and writes are exposed only through administrator- or sponsor-membership-checked RPCs. The service role cannot directly mutate the ledger.

Administrators create and issue invoices through `public.admin_create_sponsor_invoice`. Invoice currency must match the sponsor's agreed currency. Bank transfers are made outside CathoScroll; an administrator checks the bank statement and records the actual amount received using `public.admin_record_sponsor_payment`. Partial payments update the outstanding balance, overpayments are rejected, and an optional unique statement transaction key prevents duplicate allocation. Refunds are separate transactions linked to the original payment and cannot exceed its unrefunded amount. `public.admin_record_sponsor_refund` is scoped to a sponsor and original payment. Payment status is recalculated from the agreed amount and all outstanding issued invoices; the previous direct `admin_mark_sponsor_payment_received` override has had execution revoked. Invoice/payment/refund actions are appended to the administrator audit log.

Sponsor financial summaries contain only the organisation's invoices, balances and bank-transfer references. They do not expose the administrator who recorded a transaction or any other sponsor's data. Admin financial APIs require administrator-role verification, same-origin/native request validation, bounded JSON and shared rate limits. Sponsor financial APIs require an active authenticated membership. No bank account details, card details, payment-provider credentials or bank integrations are stored in CathoScroll.


## Feed analytics aggregate storage

The account-linked daily analytics tables and viewer bridge remain in the non-exposed `catho_private` schema with RLS enabled and no direct table privileges for `anon`, `authenticated` or `service_role`. Signed-in raw feed/comment/sponsor events and the user/day/topic viewer bridge are pruned in bounded batches after 180 days. Sponsor daily aggregates contain only opted-in viewable impressions, clicks and bounded active duration; there are no anonymous topic/comment tables, anonymous sponsor rows, hashed-session-frequency rows or served-delivery counters. All private tables have RLS enabled and no direct API-role table grants. Postgres-owned SECURITY DEFINER functions perform ingestion, selection, reporting and cleanup; public-facing routes call them through the server-only service-role client. Admin aggregate queries return aggregate-only payloads.


## Sponsor campaign security controls

Campaign inventory is protected by RLS with direct access revoked from public, anonymous and authenticated clients. The service role has SELECT-only access for the administrator inventory; INSERT, UPDATE and DELETE are revoked so campaign writes must use audited RPCs. Campaign creation, approval, pausing/resuming and aggregate reporting use postgres-owned SECURITY DEFINER functions with an empty search path and execution restricted to `service_role`. Administrator endpoints independently verify the administrator role, same-origin/native requests, bounded JSON and per-admin rate limits.

Campaign delivery and event recording are service-role-only RPCs. Signed-in measured delivery verifies the authenticated user and explicit Sponsor measurement consent; unmeasured delivery for signed-out or non-consenting users creates no session token, receipt, event or counter. The API returns only approved public creative fields. Opted-in event receipts validate viewable impressions, clicks and bounded active-duration events; clicks and duration require prior viewability. Campaign-wide caps, where configured, apply only to opted-in viewable impressions and are not all-visitor delivery limits. Sponsors receive aggregate opted-in metrics only, never raw user/session events or browsing histories.


## Existing Supabase advisor findings

The latest Supabase security advisor run reports several project-wide findings that predate this sponsor work and are not automatically safe to change:

- **RLS enabled without policies:** 38 tables are reported. Most are private/internal tables intentionally protected by having no direct client grants. The sponsor, membership and campaign tables are also RLS-enabled with no client policies; `anon` and `authenticated` have no table privileges. `service_role` has read-only access to `public.sponsor_campaigns` and `public.sponsor_memberships`; campaign and membership writes go through audited RPCs. Invoice, payment, member-audit and campaign-event tables in `catho_private` have no direct service-role table grants.
- **SECURITY DEFINER RPC warnings:** the advisor reports seven anonymous-callable and eighteen authenticated-callable function grants. These warnings overlap. All 18 unique callable SECURITY DEFINER functions now use an empty search_path. Public RPCs are intentionally required for published content/catalogue reads; authenticated self-service RPCs validate auth.uid() and account ownership. Do not blanket-revoke them because several are required by public content and offline sync.
- **Leaked-password protection:** Supabase Auth leaked-password protection is currently disabled. The CathoScroll Supabase organisation is on the Free plan; Supabase requires Pro or above for this feature. Upgrade the project plan before enabling it in Auth settings, then validate signup, password reset and recovery. Email verification remains disabled as requested and was not changed.
- **Unused indexes:** the performance advisor reports 38 indexes that have not yet been used. No unindexed foreign-key warnings remain after adding sponsor platform FK indexes. Several are foreign-key support indexes or belong to tables with zero production rows (including comments and sponsor campaigns). Do not drop them solely from the advisor output; reassess after representative traffic exists.

The retired anonymous analytics and sponsor-ingestion/reporting functions are removed by the release SQL; the public general-ranking RPC remains intentionally callable by anon and authenticated because it returns published content ordered by site-wide aggregate signals and reads no visitor-specific history. The production project remains on the legacy analytics schema pending the 2.4.0 release upgrade. The read-only pre-release audit found 1,391 signed-in feed events, four signed-in comment-card events, 32 legacy sponsor events (including 21 `served` events), eight anonymous feed daily aggregates, three anonymous sponsor events, three anonymous sponsor daily aggregates and one Personalisation consent row. The SQL upgrade was exercised in a rollback-only transaction; production data and schema were unchanged. The release reset clears these analytics and derived Personalisation records while preserving comments, likes, bookmarks, progress and notes. Usage-based index recommendations remain limited by this small dataset.

## Live database security-advisor review — 22 November 2026

The live Supabase security advisor reported 38 rls_enabled_no_policy informational findings. Inspection confirmed that the catho_private findings are internal tables with no Data API grants to anon, authenticated or service_role; their owner-level grants are for PostgreSQL administration/functions. The flagged public-schema tables have no anon or authenticated table grants; the few service_role grants are server-only. These are intentional private/server-only tables, not missing end-user policies. Do not add permissive RLS policies merely to silence the linter.

The advisor also reported generic SECURITY DEFINER warnings for intentionally callable public-content and self-service RPCs. The public RPCs expose published catalogue/comment/profile metrics or public like state; authenticated self-service RPCs derive the actor from auth.uid() and enforce account ownership. On 20 November 2026, the live project was hardened so the following nine functions use an empty search path: offline_catalogue_changes, offline_catalogue_counts, offline_catalogue_head, offline_activity_changes, offline_activity_head, offline_activity_snapshot, offline_apply_activity_batch, offline_apply_activity_v2, and record_feed_analytics_events. Their table/auth references are schema-qualified. All 18 unique SECURITY DEFINER functions flagged as anon/authenticated-callable now have an empty search path (the seven anon-callable warnings overlap with this set). The warnings remain generic linter warnings about SECURITY DEFINER execution, not proof of an exploitable access path; retain the input validation and role checks and review any new RPC against the same standard.

The advisor reported leaked-password protection disabled. The connected Supabase Free plan does not include leaked-password protection. This is a provider-plan limitation; it has not been changed. Supabase Free also has one-day API/database log retention, 24-hour Auth audit-log access, and no automatic backups/PITR. Maintain an independent encrypted backup and restore test.
