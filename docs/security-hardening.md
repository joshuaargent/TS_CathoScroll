# CathoScroll security hardening reference

**Updated:** 16 November 2026  
**Scope:** Website, API, Supabase database, moderation and native administrator access.

This is an operational reference, not an executable SQL script or a database migration. The Supabase schema and security changes are managed directly in the connected Supabase project, as requested. No migration files are used.

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


## Manual sponsor records

The initial sponsor register is administrator-only and does not serve adverts. `public.sponsors` has RLS enabled, no client-facing policies, and direct table privileges revoked from `PUBLIC`, `anon`, and `authenticated`; only the server-side service role has table access. The no-policy RLS advisor notice is intentional for this private table.

Sponsor creation and bank-transfer reconciliation use `public.admin_create_sponsor` and `public.admin_mark_sponsor_payment_received`. Both are postgres-owned SECURITY DEFINER functions with an empty search path, revoked from `PUBLIC`, `anon`, and `authenticated`, and executable only by `service_role`. They verify the supplied actor exists in `public.admin_users` and append an audit record in the same transaction as the sponsor change. The API independently enforces the admin/MFA session, same-origin/native request validation, bounded JSON and per-admin rate limits.

Bank transfers are made directly to the CathoScroll bank account and marked received by an administrator after checking the bank statement. The database records the server receipt timestamp and optional reference. The application does not collect bank account details or initiate payments. No sponsor account, public sponsor endpoint, ad delivery, or sponsor analytics is implemented in this phase.


## Feed analytics aggregate storage

The daily analytics tables are in the non-exposed `catho_private` schema, have RLS enabled, and grant no direct access to `anon`, `authenticated` or `service_role`. Only postgres-owned SECURITY DEFINER maintenance and admin aggregate functions access them. The user/day/topic viewer bridge is pruned in bounded batches after 180 days; the daily totals table contains no user/session identifiers and can outlive raw event retention. The rollup maintenance function is restricted to the service role and scheduled through pg_cron; the cron job runs as its database owner. Admin aggregate queries continue to return aggregate-only payloads.


## Sponsor campaign security controls

Campaign inventory is protected by RLS with direct table access revoked from public, anonymous, authenticated and service-role clients; server-side service-role access is used only through validated API routes. Campaign creation, approval, pausing/resuming and aggregate reporting use postgres-owned SECURITY DEFINER functions with an empty search path and execution restricted to `service_role`. Administrator endpoints independently verify administrator MFA, same-origin/native requests, bounded JSON and per-admin rate limits.

Campaign delivery and event recording are also service-role-only RPCs. Delivery verifies the authenticated user, serializes concurrent selection per user, locks selected campaign rows to enforce global caps, and filters by sponsor payment/status, campaign dates, targeting and frequency caps. The API returns only approved public creative fields. Event recording requires a matching served event in the same session; clicks require a prior viewable impression. Unique partial indexes prevent concurrent duplicate viewable/click events. Raw event rows and per-user frequency rows are retained only as long as required for reporting and caps; aggregate daily metrics contain no user identifiers.
