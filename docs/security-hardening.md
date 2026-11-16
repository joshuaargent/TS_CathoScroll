# CathoScroll security hardening reference

**Updated:** 16 November 2026  
**Scope:** Website, API, Supabase database, moderation and native administrator access.

This is an operational reference, not an executable SQL script. Applied schema changes are recorded in `supabase/migrations/`; `docs/cathoscroll-database-bootstrap.sql` is the canonical fresh-project snapshot.

## Database security

The live Supabase project has:

- Row Level Security enabled on every public table.
- Restricted grants for sensitive profile, comment and like data.
- No direct anonymous or authenticated SELECT access to comment content.
- No direct anonymous or authenticated SELECT access to profile subscription-tier fields.
- Public profile reads restricted to explicitly public fields.
- Raw comment/topic liker identities restricted; public counts and the current viewer's like state are returned through bounded RPCs.
- Notification updates restricted to `read_at`; a database trigger prevents content/ownership changes, client-controlled timestamps and marking read notifications unread.
- Fixed `search_path` on privileged functions, explicit execution grants and private-schema placement for internal helpers.

Important RPCs include:

- `get_own_subscription_tier`
- `get_topic_comment_page`
- `get_topic_like_state`
- `get_public_profile_metrics`
- `get_my_recommendation_page`
- `is_cathoscroll_content_admin` (SECURITY INVOKER wrapper over a private SECURITY DEFINER helper)
- `admin_user_has_verified_totp`
- Owner-only administrator role, MFA-enforcement and audit functions.

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
- Raw analytics events are retained for 180 days. A bounded database cleanup job runs every 15 minutes and removes at most 5,000 expired events per run. Admin reporting uses on-demand aggregate queries; no long-term rollup table is implemented.
- Anonymous tracking is disabled. Analytics events contain no comment text, profile fields, or email addresses.
- Sponsor and administrator reporting must use server-side aggregate functions; raw events and individual user identities must never be exposed to sponsor accounts.

- `public.get_admin_content_analytics(text,text,timestamptz,timestamptz)` is an on-demand aggregate RPC for topic/category dashboards. It is owned by postgres, uses SECURITY DEFINER with an empty search path, validates entity and date-window inputs (maximum 180 days), and is executable only by service_role. It returns counts and daily buckets only, never user IDs, session IDs or raw event rows.
- The aggregate function also counts existing likes, bookmarks, visible top-level comments, visible replies and completed-topic records separately from feed telemetry. These historical interaction records are not used to infer impressions or reading time.
- The admin pages call the existing server-side admin/MFA guard and apply a shared per-admin rate limit before invoking the aggregate RPC. The RPC is not directly executable by anon or authenticated roles.
- `public.get_top_feed_comments()` is a separate server-only selector. It is SECURITY DEFINER with an empty search path and executable only by service_role. The public endpoint returns an explicit allowlist of public comment/author/topic fields, never user IDs, emails, profile bios, moderation notes or raw events. It excludes deleted/hidden comments, replies as candidates, and comments belonging to unpublished content.

## Recommendation telemetry access

The existing `public.get_my_recommendation_page(jsonb,integer)` remains SECURITY INVOKER and authenticated-only. On a new cursor it calls `catho_private.get_user_feed_preference_signals(uuid)`, a private SECURITY DEFINER helper owned by postgres with an empty search path. The helper rejects null or mismatched account IDs using `auth.uid()`, returns only category-level scores, and is executable by authenticated users only. It does not grant access to the raw analytics table. The partial per-user/time index supports its 90-day scan.

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
- A target account must have a verified TOTP factor before it can be granted administrator access.
- Moderation, role and security actions are written to an append-only audit table; only the owner can view the paginated audit log.
- Account Security provides TOTP enrollment, backup-factor setup and enforcement activation.
- Enforcement checks AAL2 and a TOTP authentication method in API authorization and the database admin RLS helper.
- Native administrator access has a TOTP challenge gate.

**Current state:** administrator MFA enforcement remains disabled. The current owner must enroll and verify a TOTP factor, securely save the setup secret or add a backup authenticator, then enable enforcement at `/account/security`. The database refuses activation until every current administrator has a verified TOTP factor.

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

The top-comment feed selector is a server-only database function. `public.get_top_feed_comments()` is `SECURITY DEFINER`, owned by `postgres`, pins `search_path = ''`, and schema-qualifies its table and built-in function references. Execution is revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` can execute it. Browser and native clients never call this RPC directly.

Clients use `GET /api/content/top-comments`. The route calls the RPC using the server-only service-role client and applies the shared trusted-IP database rate limiter at 120 requests per IP per minute. Native CORS is restricted to the application's allowlisted origins. Native fetches omit cookies and credentials.

The endpoint returns no more than five entries and validates every field before serialising an explicit allowlist. Returned data is limited to public comment text (maximum 600 characters), public author display name/username, topic/category context, timestamps, pinned state and aggregate like/reply counts. It does not return comment-author user IDs, emails, profile bios, report details, moderation notes, or raw analytics events. If the database response contains an unexpected field or invalid value, the route fails closed with a non-cacheable 503 rather than returning an unvalidated payload.

The selector excludes deleted/hidden comments, blank comments, replies, comments outside the 90-day window, and comments belonging to unpublished topics or categories. Existing ban moderation hides comments through `is_deleted = true`, which the selector excludes. The endpoint uses a 30-second shared cache and a 30-second stale-while-revalidate window; this bounds database load while limiting the time deleted content can remain in a cached response.

Comment inventory is fetched online but is not written to a persistent local cache or duplicated in the existing offline activity queue. Previously fetched comments can remain available in the current in-memory feed session; if no inventory has been loaded and the endpoint is unreachable, the interstitial is omitted without blocking the feed. Comment-card impression/open analytics and persistent cross-session seen-state are not implemented; any future telemetry must extend the existing validated feed analytics pipeline rather than introduce a second event queue.

## Validation and limitations

Rollback-only live-database tests exercised 1,001-comment pagination, cursor progression, reply ancestry, moderation/depth checks, notification column restrictions, recommendation limits, TOTP RLS assurance and audit-log immutability. Test fixtures were rolled back; no test comments, notifications or audit rows remain.

Not yet completed:

- Owner TOTP enrollment and enforcement activation.
- Supabase Auth dashboard verification for password policy, CAPTCHA and provider rate limits.
- Leaked-password protection (available on Supabase Pro and above).
- Browser verification of CSP and deployed headers; two earlier Vercel attempts hit the daily quota, but a later preview deployment is ready and still needs manual verification.
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

Sponsor financial summaries contain only the organisation's invoices, balances and bank-transfer references. They do not expose the administrator who recorded a transaction or any other sponsor's data. Admin financial APIs require administrator/MFA verification, same-origin/native request validation, bounded JSON and shared rate limits. Sponsor financial APIs require an active authenticated membership. No bank account details, card details, payment-provider credentials or bank integrations are stored in CathoScroll.


## Feed analytics aggregate storage

The daily analytics tables are in the non-exposed `catho_private` schema, have RLS enabled, and grant no direct access to `anon`, `authenticated` or `service_role`. Only postgres-owned SECURITY DEFINER maintenance and admin aggregate functions access them. The user/day/topic viewer bridge is pruned in bounded batches after 180 days; the daily totals table contains no user/session identifiers and can outlive raw event retention. The rollup maintenance function is restricted to the service role and scheduled through pg_cron; the cron job runs as its database owner. Admin aggregate queries continue to return aggregate-only payloads.


## Sponsor campaign security controls

Campaign inventory is protected by RLS with direct access revoked from public, anonymous and authenticated clients. The service role has SELECT-only access for the administrator inventory; INSERT, UPDATE and DELETE are revoked so campaign writes must use audited RPCs. Campaign creation, approval, pausing/resuming and aggregate reporting use postgres-owned SECURITY DEFINER functions with an empty search path and execution restricted to `service_role`. Administrator endpoints independently verify administrator MFA, same-origin/native requests, bounded JSON and per-admin rate limits.

Campaign delivery and event recording are also service-role-only RPCs. Delivery verifies the authenticated user, serializes concurrent selection per user, locks selected campaign rows to enforce global caps, and filters by sponsor payment/status/date windows, campaign dates, targeting and frequency caps. The API returns only approved public creative fields. Each card placement receives its own placement/session UUID; returning to the same card reuses that ID. Event recording requires a matching served event in the same placement session; clicks require a prior viewable impression. Unique partial indexes prevent concurrent duplicate viewable/click events. Raw event rows and per-user frequency rows are retained only as long as required for reporting and caps; aggregate daily metrics contain no user identifiers. The bounded retention job automatically completes expired approved/paused campaigns and removes their frequency rows after the retention window.


## Existing Supabase advisor findings

The latest Supabase security advisor run reports several project-wide findings that predate this sponsor work and are not automatically safe to change:

- **RLS enabled without policies:** 27 tables are reported. Most are private/internal tables intentionally protected by having no direct client grants. The sponsor, membership and campaign tables are also RLS-enabled with no client policies; `anon` and `authenticated` have no table privileges. `service_role` has read-only access to `public.sponsor_campaigns` and `public.sponsor_memberships`; campaign and membership writes go through audited RPCs. Invoice, payment, member-audit and campaign-event tables in `catho_private` have no direct service-role table grants.
- **SECURITY DEFINER RPC warnings:** the advisor reports six anonymous-callable and thirteen authenticated-callable functions. These are existing public/offline/feed RPCs and must be reviewed individually for actor checks, bounded inputs and grants. Do not blanket-revoke them because several are required by public content and offline sync.
- **Leaked-password protection:** Supabase Auth leaked-password protection is currently disabled. The CathoScroll Supabase organisation is on the Free plan; Supabase requires Pro or above for this feature. Upgrade the project plan before enabling it in Auth settings, then validate signup, password reset and recovery. Email verification remains disabled as requested and was not changed.
- **Unused indexes:** the performance advisor reports 38 indexes that have not yet been used. No unindexed foreign-key warnings remain after adding sponsor platform FK indexes. Several are foreign-key support indexes or belong to tables with zero production rows (including comments and sponsor campaigns). Do not drop them solely from the advisor output; reassess after representative traffic exists.

No new sponsor platform SECURITY DEFINER RPC warning was reported. The current production project has zero comments, comment likes, feed analytics events, sponsors and campaigns, so usage-based index recommendations are not yet representative.
