<div align="center">

# CathoScroll

### Learn Catholic teaching one swipe at a time

Explore Catholic theology, Scripture, Church history, apologetics, prayer, and doctrine through a modern educational experience designed to make learning the faith more accessible and engaging.

[![Website](https://img.shields.io/badge/Website-www.cathoscroll.com-0D9488?style=for-the-badge&logo=vercel&logoColor=white)](https://www.cathoscroll.com)
[![GitHub](https://img.shields.io/badge/GitHub-joshuaargent-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/joshuaargent)

<br />

![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)

</div>

---

## About this project

CathoScroll is a Catholic educational platform built to make learning the faith more accessible, engaging, and approachable.

Many people encounter Catholic teaching through books, podcasts, videos, social media, parish resources, RCIA programmes, and countless scattered websites. CathoScroll aims to bring that learning experience together in a single place through concise educational topics, community discussion, progress tracking, and structured learning.

Whether you're exploring Catholicism for the first time, returning to the faith, preparing for RCIA, or simply seeking to deepen your understanding, CathoScroll is designed to help you learn at your own pace.

## What you'll find here

- **Topic feed** - browse Catholic topics through an endless feed designed for exploration and discovery.
- **Categories** - explore topics by area, including God, Jesus Christ, Scripture, prayer, the Church, apologetics, and more.
- **Search** - quickly find specific questions, teachings, people, events, and concepts.
- **Bookmarks** - save topics to revisit later.
- **Progress tracking** - keep track of completed topics and learning streaks.
- **Community discussion** - comment, reply, like contributions, and engage with other learners.
- **Public profiles** - view user profiles, progress, activity, and community contributions.
- **Structured learning** - planned premium learning paths that guide users through key areas of Catholic teaching.
- **Audio lessons** - planned premium narrated audio versions of topics; written topics remain free.
- **Quizzes** - planned premium quizzes designed to reinforce learning and understanding.
- **SEO and discoverability** - sitemap generation, robots rules, metadata, and rich social previews.
- **RSS feed** - public topic feed available at `/feed.xml`.
- **Responsive design** - designed to work seamlessly across desktop and mobile devices.

## Feed experience

The topic feed retains the original recommendation-driven navigation model. Signed-in users receive topics in the order returned by the recommendation service; signed-out users receive a shuffled catalogue. Additional pages are appended using the active recommendation or catalogue cursor. Once the available catalogue is exhausted, the existing topic sequence loops without reshuffling it.

- **Analytics-ranked topics:** The feed consumes the server-owned recommendation page and cursor. Category preferences combine completed topics, bookmarks, likes and distinct comments with 90 days of decaying feed telemetry: viewable impressions, active duration, swipe depth, completion and return visits. Skips reduce preference only after at least two distinct sessions. The ranking balances served topics against category weight and avoids long same-category streaks. The initial category preferences are frozen in the cursor, so pagination preserves the same session ordering. Signed-in topics are never locally shuffled. Native uses the same recommendation RPC and falls back to its saved catalogue only when recommendations are unavailable.
- **Top Comments:** Up to five eligible, unseen top-level comments are inserted after every five topic advances when inventory is available. Further 100-comment inventory pages are fetched as the unseen pool runs low, with duplicate IDs removed. The selected group is cached against the topic that introduced it. Returning to that topic replays the same group instead of selecting different comments.
- **Sponsored placements:** Eligible campaigns are considered after every ten topic advances for signed-in users. When both card types are due at the same boundary, Top Comments appears first and the sponsor follows it. Each sponsor placement is cached against its topic and keeps its attribution session ID when revisited. Campaign selection uses the existing rolling 30-day weighted fair-queue pacing based on viewable impressions; sponsorship does not affect organic recommendations.
- **Session mapping:** Topic order, comment groups, sponsor placements, cadence and reserved-comment IDs remain in memory for the active account session. Back/forward navigation and looping reuse those mappings. A full page/app reload or account change starts a new mapping. Background native catalogue updates append previously unseen topic IDs without replacing loaded history or changing the active topic.
- **Navigation:** Topic, comment and sponsor cards use the existing vertical swipe/navigation callbacks and shared transition components. Moving backwards from a comment returns to its topic; moving backwards from a sponsor returns to the comment first when both were inserted at the same boundary. A cancelled sponsor request remains attached to its topic and is retried when the user moves forward again.
- **Card surfaces:** The progress-bar region stays on the neutral feed background. The subtle accent tint is applied only to the topic/comment card surface beneath it.
- **Analytics:** Feed impressions, viewable impressions, active duration, early skips, slide depth, completion and repeat visits continue through the existing analytics pipeline. Visit/completion deduplication survives topic-viewer unmounts when interstitials appear. Sponsor served, viewable-impression and click events use their separate durable, authenticated reporting pipeline. Both queues are best-effort and never block navigation; offline topic telemetry is bounded to 200 unacknowledged events per account, and sponsor reporting retains up to 1,000 pending placement events.

Implementation and operational details are maintained in [Feed experience and analytics](docs/feed-experience-and-analytics.md), [Feed analytics implementation](docs/feed-analytics-implementation.md), and [Sponsor platform](docs/sponsor-platform.md). The temporary logo-free deployment bridge and final cleanup are documented in [sponsor-logo-compatibility.sql](docs/sponsor-logo-compatibility.sql) and [sponsor-logo-removal.sql](docs/sponsor-logo-removal.sql); the narrow upstream dependency exception is documented in [security-dependency-exceptions.md](docs/security-dependency-exceptions.md).

## Why CathoScroll?

The goal of CathoScroll is not simply to provide information.

The goal is to help people understand:

- What Catholics believe.
- Why Catholics believe it.
- Where those beliefs come from.
- How different teachings fit together.

By combining educational content, planned structured learning, and community discussion, CathoScroll aims to make learning more welcoming and approachable.

## Built with

| Area           | Technology              |
| -------------- | ----------------------- |
| Framework      | Next.js 16 · App Router |
| UI             | React 19                |
| Language       | TypeScript 5            |
| Styling        | Tailwind CSS 4          |
| Database       | Supabase                |
| Authentication | Supabase Auth           |
| Hosting        | Vercel                  |
| Analytics      | Vercel Analytics        |
| Icons          | Lucide React            |
| Code quality   | ESLint                  |
| Formatting     | Prettier                |

## Run locally

### Requirements

- Node.js 20.19+ within the 20.x release line, or Node.js 22.12+
- npm

### Setup

```bash
git clone https://github.com/joshuaargent/TS_CathoScroll.git
cd TS_CathoScroll
npm install
cp .env.example .env.local
npm run dev
```

In Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

Before starting the app, add your Supabase project URL and anonymous key to `.env.local`. The contact form's Formspree ID is optional.

Open:

```txt
http://localhost:3000
```

## Android app

The Android app bundles its interface and published topic catalogue. Install
dependencies, put the public Supabase URL and anonymous/publishable key in
`.env.local`, and use Node.js 22.13 or newer. Then build and open the project:

```bash
npm run cap:open:android
```

This exports a fresh catalogue, builds the app and synchronizes Android before
opening Android Studio. Build the APK or app bundle there. `npm run cap:sync`
also builds and synchronizes Android and Electron. Rebuild and synchronize
after native code or catalogue changes; a Vercel deployment alone does not
update the bundled interface. Sign upgrades with the same Android signing key
as the installed app. The GitHub release workflow uses the long-lived
keystore stored in the `ANDROID_KEYSTORE_BASE64` Actions secret; back up the
original keystore and its passwords securely and never regenerate it. Losing
or replacing this key prevents in-place updates and requires users to
uninstall and reinstall the app. The first production-signed release also
cannot update an older debug-signed installation: sync queued account
activity while online, uninstall the debug build, then install the signed APK.
The iOS project is not part of this release.

The source logo is `assets/logo.png`; regenerate native artwork with
`npm run assets:generate` if it changes.

## Desktop app

CathoScroll has a bundled Electron desktop target powered by Capawesome's
Capacitor Electron platform. It uses the same offline catalogue and account
sync as Android. Configure the public Supabase values as described above.

After installing the root dependencies with `npm install`, start the desktop
app with:

```bash
npm run desktop:run
```

Create a distributable installer for the current operating system with:

```bash
npm run desktop:package
```

Both commands export a fresh catalogue and synchronize Electron before running
or packaging it. Installers are written under `electron/dist`. Packaging,
signing, upgrades, and online/offline account flows must be tested on each
target OS before release.

## Building and publishing releases

CathoScroll uses two separate GitHub Actions workflows:

- **CathoScroll Release Build Validation** runs for pull requests targeting `main` and can also be started manually from the Actions tab. It runs the unit tests, ESLint, TypeScript checks, Android release-APK compilation, and Windows x64, Linux x64, and universal macOS packaging checks. These validation builds do not publish a release.
- **CathoScroll Release** runs when a version tag matching `v*.*.*` is pushed. It validates the source again, builds the signed Android APK and desktop installers, verifies the expected outputs, and publishes the GitHub release.

### Before tagging a release

1. Merge the release PR into `main` only after the latest validation workflow has passed and the code review findings have been addressed.
2. Ensure the matching website changes have deployed to production. Native apps call the production website API; a successful native build does not deploy those APIs.
3. Keep the versions in the root `package.json`, `electron/package.json`, and Android Gradle configuration aligned. The release workflow checks the root and Electron package versions against the tag and supplies the tag version to the Android build.
4. Confirm the repository Actions configuration contains the required public Supabase repository variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Confirm these Android signing secrets exist in the repository's Actions secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. The keystore must be the same long-lived signing key used for previous production releases. Back it up securely; never commit the keystore or passwords.

### Triggering a release

Create and push an annotated version tag from the merged `main` commit. For example, for the current 2.3.2 package version:

```bash
git checkout main
git pull origin main
git tag -a v2.3.2 -m "CathoScroll v2.3.2"
git push origin v2.3.2
```

The tag push starts the release workflow. Do not create a separate manual release or upload build files yourself; the workflow creates/updates the GitHub release and publishes it after the platform builds and asset checks succeed. The workflow generates GitHub release notes automatically from the changes since the previous release.

You can create the tag with GitHub Desktop's tag interface instead of the terminal, provided the tag is created from the merged `main` commit and pushed to GitHub. Merging the pull request itself can be done directly on GitHub using **Squash and merge**; no local Git command is required for that step.

### Published release files

The workflow verifies and publishes:

- **Windows:** x64 installer (`.exe`).
- **Linux:** x64 AppImage and Debian package (`.deb`).
- **macOS:** universal DMG and ZIP. macOS builds are unsigned; users may need to follow the documented macOS first-launch security steps.
- **Android:** signed versioned APK (`CathoScroll-<version>.apk`).

Desktop builds also publish the update metadata used by the desktop auto-updaters, including `latest.yml` and `latest-linux.yml`. Windows and Linux AppImage updates download in the background and install on app exit. Linux DEB downloads automatically but requires system authorization to apply. macOS updates remain manual download-and-reinstall.

After the workflow completes, inspect the [GitHub Releases](https://github.com/joshuaargent/TS_CathoScroll/releases) page and confirm that every expected installer, the Android APK, release notes, and desktop update metadata are present. Do not distribute a release if any platform job or required asset-verification step failed.

The CI packaging checks prove that the packages can be built; they do not replace real-device upgrade, migration, offline, reconnect, or platform-specific installation tests. See the release verification plan below.

### Current rate limits

PostgreSQL enforces the following account-level mutation limits. These also
apply when a modified client calls Supabase directly rather than using the
website routes.

| Operation | Limit |
| --- | ---: |
| Comment creation, replies, and edits | 10 / 10 minutes, 40 / hour, 120 / 24 hours |
| Comment likes | 180 / hour |
| Topic likes | 180 / hour |
| Bookmark changes | 120 / hour |
| Progress changes | 1,000 / hour |
| Comment-ban appeals | 3 / 24 hours |
| Recommendation RPC | 30 / minute |
| Offline activity RPC operations | 300 / minute |

Vercel-facing IP limits additionally protect public search (180 / minute),
topic pagination (120 / minute), feed and sitemap requests (60 / minute),
and appeal submissions (5 / 10 minutes per IP). Appeal submissions also have
a per-user cooldown of one per 10 minutes. Administrative routes have
separate per-admin limits. The shared API limiter uses atomic Postgres
counters and HMAC-derived identifiers; it does not store raw client IPs.
Responses include `Retry-After` where the route returns a rate-limit response.

## Security posture and operational checks

The database intentionally exposes a small set of read-only
`SECURITY DEFINER` RPCs for public profile metrics, published topic comments,
topic like counts, and published offline catalogue data. These functions use
fixed search paths and return only the public data required by those features.
Account activity RPCs are restricted to authenticated users and compare the
requested account with `auth.uid()`. Administrative mutation functions are
restricted to the service role and are called only from trusted server code.
The private `catho_private` schema has no direct client table grants; its
RLS-enabled tables intentionally have no client policies because access is
through the checked functions.

Supabase's security advisor may still flag these intentionally exposed
`SECURITY DEFINER` functions and RLS-enabled private tables without policies.
Review the function grants and ownership checks before changing them; removing
their execute grants indiscriminately would break public reads or account sync.
The current Auth configuration also has leaked-password protection disabled.
The CathoScroll Supabase organisation is currently on the Free plan; Supabase
requires Pro or above for leaked-password protection. Upgrade before enabling
it in Auth settings. Email verification is a separate setting and remains
disabled. Admin MFA enforcement remains a separate rollout task:
enrol and verify the owner/admin accounts first, then enable enforcement so
administrators are not locked out.

The production database is currently small, so unused-index warnings are not
evidence that those indexes should be dropped. Keep indexes that support
known keyset, retention, foreign-key, and activity queries until representative
traffic and query plans show they are unnecessary. Review Supabase security
and performance advisors after schema or traffic changes.

The repository's CI checks source, tests, types, dependencies, secrets, and
CodeQL. They do not prove production capacity. No production load test or
independent penetration test is claimed. Perform concurrency tests on a
separate staging project and verify deployed HTTP security headers, CSP
enforcement, and real-device offline recovery before a large public launch.

## Configuration

Copy `.env.example` to `.env.local` in the project root and fill in the values for your project. `.env.local` is ignored by Git; commit changes to `.env.example` when the required variables change, never your real credentials.

## Authentication and protected pages

The `/account` and `/bookmarks` pages have two layers of sign-in checks:

1. The Next.js 16 `src/proxy.ts` layer validates the Supabase session and redirects signed-out requests to `/signin`, preserving the requested local path so sign-in can return the user to it.
2. The account page repeats the check client-side, and the bookmarks page checks the session on the server before reading user data.

These redirects improve navigation but do not replace authorization. Supabase Row Level Security policies and server-side checks must continue to protect user data and mutations. The moderation dashboard and moderation API routes independently verify the signed-in user's database-backed admin role; hiding admin UI is never treated as authorization.

### Supabase write-permission hardening

Supabase schema changes are managed directly against the connected project. The repository intentionally maintains no Supabase migration files; the complete application schema is consolidated in `docs/cathoscroll-database-bootstrap.sql` for fresh-project recovery. That bootstrap is not an incremental upgrade script and must never be run against an existing project.

Comment pinning and moderation use server endpoints and a database-backed `admin_users` role table. The service-role key is used only on the server and must never be exposed in a `NEXT_PUBLIC_*` variable. The canonical bootstrap contains the application tables, constraints, comment-ban insert/edit triggers, atomic moderation functions and report throttling function. Do not maintain or apply a separate chain of SQL migration files.

Authenticated users can privately report comments. Admins can review and dismiss reports, resolve them, or hide the reported comment. Comment restrictions prevent new comments, replies, and edits, but do not disable sign-in or other account features; users can still delete their own comments. Admins may optionally hide a user's existing visible comments when applying a restriction, while retaining them in moderation history. Restricted users can submit one pending appeal; admins can review paginated comment history with reply context and lift the restriction. Subscription tiers must only be changed by trusted billing/server-side code.

The notification center is available to signed-in users from the navbar bell. It displays the latest 50 notifications and supports marking one or all as read; the badge shows `1`–`9`, then `9+`, and is hidden when there are no unread notifications. The notification table, owner-only RLS policies, and database notification triggers/functions are included in the canonical bootstrap for fresh-project recovery; do not run that bootstrap against an existing project. Those database-side handlers create welcome, reply, and moderation notifications transactionally; email notifications are not used.

### Database-backed topics and recommendations

Topics and categories are read from the public `topics` and `categories` tables. The initial catalog has been imported into Supabase; new and updated content should be managed in the database. Topic IDs and URL slugs remain stable after creation because user activity and external links may refer to them.

Public category, topic-detail, topic-page, topic-count, and topic-by-ID reads use a five-minute tagged server cache. Feed and category browsing use keyset pagination (50 topics per request), and topic detail loads only its neighbors and a few related topics. Search is server-side and returns at most 30 ranked results using the `topics.search_vector` GIN index and `search_published_topics` RPC; apply the matching SQL setup before deploying that search change. Sitemap generation is split into bounded files. RSS contains the 50 most recently created published topics, rather than the whole catalogue; creation time is not necessarily publication time. Admin content updates invalidate the tagged content cache. This improves the website's data-query and response behavior as the catalogue grows; it is not an offline copy.

Admins can create and edit categories and topics from `/admin/content`, including descriptions, Catechism and Scripture fields, ordering, and publication status. Unpublishing archives content without deleting rows or breaking user activity. Topic IDs and slugs and category slugs are fixed after creation. Admins can grant another user administrator access from that user's profile; role changes are handled server-side and cannot be self-granted through this action.

### Offline apps and synchronization

The website remains server-rendered and Supabase is the online source of truth.
Android and Electron bundle a validated SQLite catalogue so the feed, topics,
categories, and local substring search remain available without a connection.
Online search uses the ranked `search_published_topics` RPC; if that request
fails, the app reports the issue and searches the saved catalogue locally.
Local substring search is a fallback, not a replacement for ranked server
search on a large catalogue.

The weighted full-text index and ranked-search RPC are included in the complete database bootstrap described below.

#### Published catalogue synchronization

`npm run native:build` exports the published catalogue using the public
Supabase configuration from `.env.local` or the environment. The export
checks server counts and revision before replacing its previous snapshot, and
`offline:database` verifies its checksum and SQLite integrity. A changing or
incomplete export fails rather than packaging partial content.
`native:build:local` uses an existing export and is intended for local testing.

The app starts with the bundled catalogue and stores its last applied server
revision. When online, it requests only catalogue changes after that revision,
applies the changes to a staging copy, validates the result, and publishes it
atomically. An interrupted refresh leaves the previous catalogue intact. If
the server has pruned the required change history or the local state is
invalid, the app downloads and validates a complete replacement snapshot.
Published categories and topics are reconciled, so unpublished or removed
content does not remain available in the refreshed catalogue.

Catalogue change history is retained for approximately 31 days. A scheduled
Supabase job prunes older events in bounded batches every 15 minutes. If a
device has been offline longer than the retained history, it performs a full
catalogue refresh rather than trying to replay an incomplete change feed.
The bundled checksum and import timestamp describe the original packaged
catalogue; local counts describe the current refreshed catalogue.

#### Account activity synchronization

Bookmarks, topic likes, and completed-topic progress are written to the local
account database first. The interface therefore updates immediately and does
not need a network round trip to save an action. Each change is also appended
to a durable outbox with a unique operation ID, a monotonically increasing
device sequence, and the affected account, topic, activity type, and value.
The outbox survives application restarts and temporary loss of connectivity.

When connectivity is available, the sync worker sends up to 100 queued
operations in one authenticated `offline_apply_activity_batch` RPC. The
server processes the operations in order and returns an individual receipt
for each one. Receipts identify the account and operation and include the
server activity revision. The client validates every receipt and removes only
the operations that the server has confirmed. If a request succeeds on the
server but its response is lost, retrying the same operation IDs returns the
existing receipts rather than applying the actions twice or consuming another
sync-rate-limit slot.

Each device has its own sequence and acknowledgement cursor. All operations
in one batch carry the same last client-confirmed acknowledgement, and their
device sequence numbers must be contiguous. The server deliberately does not
treat an earlier receipt in the same response as acknowledged: the client can
only confirm the batch after it has received and committed the complete
response locally. This means a lost response can safely replay the entire
batch and receive the same receipts without duplicating writes. On the next
batch, the client advances its acknowledgement cursor and the server can
discard the earlier receipts and sequence mappings. An unavailable or
unpublished topic is recorded as a rejection and archived locally; it does
not block later queued actions. When
the account is too far behind the retained change history, the client stages
a fresh activity snapshot, reconciles changes made during the snapshot, and
publishes the replacement atomically while preserving pending local edits.

The batch endpoint is limited to 100 operations per request. Server-side
activity writes are additionally limited to 300 operations per account per
minute, including attempts against unavailable topics. Existing per-action
limits also apply to the underlying writes: bookmarks are limited to 120 per
hour, topic likes to 180 per hour, and progress changes to 1,000 per hour.
When an action limit is reached, the batch returns a deferred receipt for the
first unprocessed operation. Earlier successful receipts are retained and
acknowledged; the deferred operation remains queued for a later retry. The
native app displays that saved changes are waiting for the limit to reset,
keeps sign-out blocked while the outbox is non-empty, and clears the message
when syncing resumes. These limits are enforced in Postgres and cannot be
bypassed by calling the RPC directly from a modified client.

The in-process background worker retries failed requests after 30 seconds
and normally checks for further changes every 60 seconds while the app is open
and online. It is not an operating-system background task: closing the app
stops network sync, but the durable outbox remains on disk and resumes on the
next launch. A run uploads at most 100 operations and downloads at most 10
change pages; if a limit is reached while work remains, it schedules another
run. Each activity
change page contains at most 100 server events. Snapshot pages contain at
most 100 current activity records. These bounds prevent one reconnect from
creating an unbounded request or transaction.

Activity events are retained for approximately 31 days and pruned in bounded
batches by a Supabase job that runs every five minutes. Acknowledged operation
receipts and device-sequence mappings are discarded as the device confirms
later operations; the device's server-side high-water marks remain, so old
acknowledged sequence numbers cannot be replayed. Unacknowledged operations
remain available for retry. Monitor both scheduled cleanup jobs and their
latest run status in Supabase.

The activity RPCs are account-bound: they compare the requested user with
`auth.uid()`. Internal activity, receipt, device, and rate-limit tables are
not directly exposed to anonymous or authenticated table access. RLS remains
enabled on the public sync tables. The batch RPC is executable by authenticated
users only. The existing single-operation `offline_apply_activity_v2` RPC
remains available for compatibility and is subject to the same server-side
per-account write limit. Do not grant
clients direct write access to internal synchronization tables.

#### Local account data and security

Account activity, cached comments, topic counts, and note records are stored
in the private local database. Android uses encrypted SQLite with a
device-specific key protected by Android secure storage. Electron uses an
encrypted SQLite database with its key protected by the operating system's
secure storage; on Linux, a supported desktop secret-store backend is required.
The catalogue is public content and is stored separately from private account
data. Android backup and device-transfer rules exclude private activity
databases and encryption keys.

Bootstrap and history-expiry recovery stage snapshots before publication,
preserving pending edits. Legacy activity and cache tables are copied
transactionally, then the encrypted database is checked for integrity and its
migration marker is verified before the plaintext database and SQLite
sidecars are removed. Existing catalogue databases are checked on startup; a
damaged catalogue is rebuilt from a validated bundled snapshot without
touching private user data. Electron removes legacy activity database
locations after verification; if cleanup fails, the private store remains
usable and cleanup is retried on the next launch.

Sign-in, sign-up, and profile changes require a connection. Sessions and
encryption keys use Android Keystore-backed storage or Electron's
operating-system secure storage. Signing out requires a connection and is
blocked while activity is queued. Encryption keys are device-specific and
excluded from Android backup; unsynchronized changes cannot be expected to
transfer to another device. The app does not silently discard queued changes
when an account signs out.

Previously fetched comment discussions and counts can be read offline but may
be incomplete or stale. Comment writes remain online-only. Notes can be edited
online after the latest note has loaded; notes opened online are cached for
read-only offline access. The latest 50 notifications and their unread count
are stored in the private account database. Notifications must first be
loaded online; read changes made offline are queued and synced after
reconnect. Marking all as read offline covers notifications known to that
device, not notifications received afterwards. Reporting and moderation
require an internet connection; native administrators can use the same
moderation workflows as the website.

#### Operational and scale notes

The database uses per-account activity revisions rather than a single global
revision counter, so unrelated users do not contend on one shared activity
head. The activity event stream, device receipts, rate-limit counters, and
catalogue history have supporting indexes and bounded cleanup. The website
uses keyset pagination for feed and category browsing, tagged caching for
public content, and the ranked search GIN index; it does not download entire
user activity tables to render a feed.

These design choices bound normal requests and isolate most write contention
by account, but they do not prove a particular concurrent-user capacity.
Before a major public launch or a significant increase in traffic, run load
tests against a separate staging Supabase project with representative data.
Measure p50/p95/p99 API latency, database CPU and I/O, connection pool
saturation, lock waits, slow queries, sync backlog drain time, and error rates.
Test concurrent feed browsing, search, activity batches, comments, and
reconnect storms. Do not run destructive or high-volume load tests against
production. Increase Supabase compute and connection-pool capacity based on
measured saturation, not estimated user counts.

Real-device upgrades, reconnects, long-offline recovery, account switching,
and packaged desktop releases still need end-to-end verification before
distribution. Windows NSIS and Linux AppImage updates download in the
background and install on app exit. Linux DEB updates also download
automatically, but applying them requires system authorization through the
package installer. macOS remains unsigned and uses a manual
download-and-reinstall update flow.

Signed-in feed recommendations require the `get_my_recommendation_page` RPC and supporting indexes supplied separately for Supabase. It aggregates each user's completed topics (weight 5), bookmarks (4), likes (3), and distinct commented topics (3) across the published catalogue into category preferences. For each category, a weight of `1 + sqrt(preference)` reduces the effect of very large histories while allowing every category to be explored. The RPC takes the next unfinished topic from indexed category streams, selecting the category with the smallest `served / weight` and avoiding three consecutive topics from the same category when alternatives exist. This approximates a globally personalized ranking without loading or sorting the whole catalogue. The per-category cursor and preference snapshot are carried across pages; a refresh picks up changed preferences. Progress is checked as pages load, and content edits or unpublishing can change subsequent results. If every topic is complete, the initial page falls back to completed topics. The cursor is limited to 200 published categories and 64 KiB; the RPC rejects larger catalogues explicitly. Recommendation responses are private and uncached. Signed-out users retain the shuffled feed.

The feed viewer requests exact like and visible-comment counts and the signed-in user's activity for the current topic only. It does not download the full likes, comments, bookmarks, or progress tables. Exact counts still require database work proportional to the matching rows; very popular topics may eventually need maintained aggregate counters. Recommendation quality and query performance should be measured with real usage rather than assumed to match large commercial recommendation systems.

### Feed analytics and recommendations

The feed records topic impressions, viewable impressions, active reading time, skips, slide depth, completions, and return visits. Events are queued per signed-in account in persistent browser/WebView storage, sent in batches of up to 50, and removed only after the server accepts the batch. The queue is retained while offline and is flushed when connectivity returns, when the analytics transport is installed at app startup, and when the app is backgrounded or closed. Native apps use the same authenticated analytics endpoint and obtain the access token from the native Supabase session. This is a durable local queue across normal app restarts, not a guarantee against app-data deletion, storage eviction, or local storage quota exhaustion.

The recommendation algorithm combines explicit account activity with bounded, decaying feed behaviour signals. Explicit weights are completed topics (5), bookmarks (4), topic likes (3), and distinct commented topics (3). The recommendation RPC also reads the last 90 days of feed telemetry: viewable impressions, active reading duration, swipe depth, completions, and return visits contribute positive evidence; skips contribute negative evidence only after the topic has been skipped in at least two distinct sessions. Telemetry decays with a 30-day half-life, is capped per topic and event family, and the combined topic contribution is bounded before being aggregated into category preferences. Raw impressions alone are not a positive ranking signal. These limits reduce (but do not eliminate) feedback loops and popularity bias; ranking changes should be evaluated against a control cohort before further tuning.

Sponsor served events are recorded by the delivery API. Viewable-impression and click events are queued per account with stable event IDs and their original placement-session IDs. The feed-level sync worker retries them in order at startup, after reconnect, and when the app returns to the foreground—even when no sponsor card is currently visible. The server remains authoritative: it validates campaign/session state and deduplicates accepted events. Events for expired or otherwise permanently ineligible placements are discarded instead of blocking newer events; temporary authentication, network, rate-limit, and server failures remain queued for retry. The sync worker stays mounted at the app shell across route navigation. New sponsor placements are allocated online only. A placement already allocated in the active feed session may replay when the user navigates backward, preserving the feed mapping; no new sponsor is selected offline and placements are not persisted across sessions. Local event storage is best-effort if the operating system clears app data or storage is exhausted.


| Variable                        | Purpose                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Optional. Canonical site URL used for metadata, sitemap, and feed generation. Defaults to `https://cathoscroll.com`. |
| `NEXT_PUBLIC_SUPABASE_URL`      | Required. Supabase project URL.                                                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required. Supabase publishable/anonymous key used by the client.                                                     |
| `NEXT_PUBLIC_FORMSPREE_FORM_ID` | Optional. Formspree form ID for contact form submissions.                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Required for server-side comment moderation, reports, and appeals. Keep secret.                                      |

Never put Supabase service-role keys or other server secrets in `NEXT_PUBLIC_*` variables.

## Native page parity and offline behaviour

The website and Android/Electron apps render the same shared
`AccountPageView`, `PublicProfileView`, `CategoriesGrid`,
`CategoryTopicGrid`, `CategoryBottomNavigation`, `SigninForm`, and
`SignupFormView` components. These keep the account, public profile,
category, and topic-card layouts aligned while platform adapters own
authentication, data loading, navigation, and offline policy. Profile streak
calculations and bookmark card/date formatting are shared as well.

The native account adapter reads its profile from Supabase when connected and
uses the encrypted per-device profile cache for read-only display when
offline. Membership is always treated as live data; the app does not present
an old cached tier as current. Profile, email, password, sign-in, and sign-out
changes require a connection and are never silently queued.

The website and native app also share `NavbarView`. The native app supplies
its own notification bell, navigation handling, and offline activity data
without duplicating the shared visual component. Bookmark save timestamps are
cached locally after the app has loaded the online bookmark list, and
timestamps for bookmarks created on the device are recorded immediately. An
older server bookmark that has never been refreshed by the app may not have
its original save date while offline; the activity snapshot protocol does not
currently include bookmark creation timestamps.

The native router also renders the website's shared About, FAQ, Contact,
Privacy, Terms, and Cookies page components. The contact form uses the optional
`NEXT_PUBLIC_FORMSPREE_FORM_ID` value at native build time; if it is not
configured, the page displays its fallback contact details.

Online comment discussions use the native secure Supabase session. Comment
likes, posts, replies, edits, and deletes use Supabase directly. Private
comment reports and administrator comment pinning use the website API over
HTTPS with the user's access token; the service-role key remains server-only.
Native API CORS is restricted to the local Capacitor and Electron origins
(`capacitor://localhost`, `capacitor-electron://localhost`, `http://localhost`,
and `https://localhost`). The matching website API deployment must be live before
the native app release is distributed.
The native router also exposes the admin dashboard, reports, appeals,
comment restrictions, and content library. Public profiles also expose the
website's administrator-role and comment-restriction controls to authorized
native administrators. These routes reuse the website's admin navigation,
report list, appeal list, comment restriction controls, role control, and
content editor. Native requests use the signed-in user's bearer token and are
independently authorized against the database-backed `admin_users` role on the
server; no service-role credentials are shipped in the app. Admin reads and
mutations remain online-only. Comment reporting, pinning, and all comment
writes require an internet connection; cached discussions are read-only and
may be stale.

### Offline reliability rules

- Treat `navigator.onLine` only as a connectivity hint. Every online request
  must still handle timeouts, authentication expiry, server errors, and
  connectivity loss between the check and the request.
- Keep cached catalogue, profile, comments, notifications, and account activity
  scoped to the correct signed-in user. Never show one account's private cache
  after an account switch.
- Keep queued likes, bookmarks, and progress in the encrypted activity store.
  Do not clear the outbox on sign-out, account changes, failed sync, or an
  unavailable topic; require successful synchronization before signing out.
- Treat account credentials, profile edits, email changes, password changes,
  comment writes, reports, and moderation as online-only operations. Disable
  them offline and explain why rather than pretending they will sync later.
- If optional local cache storage fails while online, continue using the live
  service. A broken local cache must not take down online account, catalogue,
  or comment access.
- When a live read fails, show the last valid cached copy where one exists and
  label it as potentially stale. Never replace a valid cache with an incomplete
  response.
- On reconnect, retry interrupted refreshes and queued activity without
  starting duplicate concurrent syncs. A retry must not apply the same
  operation twice; server operation IDs and acknowledged sequence numbers
  provide idempotent recovery.
- Keep global connection, cache, and synchronization warnings in the bottom
  status popup. Keep field validation and action-specific failures beside the
  control that needs attention.

### Recent reliability safeguards

The 2.2.0 release work also includes safeguards that should be preserved when changing these flows:

- Catalogue startup validates metadata and row counts before advancing SQLite cursors. A valid catalogue must not be rejected because a cursor was moved before its metadata was read.
- Comment-history GET requests accept browser same-origin requests even when the browser omits the `Origin` header. When `Origin` is absent, the route requires browser-provided same-origin fetch metadata or an exact same-origin referrer; a present but invalid origin is still rejected. The route's existing administrator authentication and authorization checks remain mandatory.
- Category and topic pagination responses are tied to the current list request generation. When a refresh or retry starts a new list, older first-page and load-more responses are ignored so they cannot append stale rows, overwrite the current cursor, or change the new request's loading/error state.
- Note saves, bookmark operations, and notification read queues remain scoped to their account/topic or account/notification identities. A result from an earlier screen or account must never overwrite the state of the current one.

### Release verification plan

Before publishing a release, run unit tests, ESLint, TypeScript, Android APK
compilation, and Windows, Linux, and universal macOS packaging checks. Then
perform real-device tests for: cold start offline; first launch without a
catalogue or secure database; sign-in and sign-out with queued activity;
network loss during feed pagination and profile saves; reconnect during an
active sync; expired sessions; account switching; unavailable/unpublished
topics; comment cache refresh failures; report rate limits; and Android update
download/install recovery. Desktop first-run, update, and Gatekeeper flows
must also be checked on their respective operating systems. CI packaging is
not a substitute for these device-level checks.

## Features

### Learning Experience

- Infinite topic feed
- Category browsing
- Full text search
- Topic bookmarking
- Progress tracking
- Learning streaks

### Community

- Comments and replies
- Comment likes
- Pinned comments
- Private comment reporting and admin moderation
- Comment-only restrictions with user appeals
- In-app notifications for replies, welcome guidance, and moderation updates
- Public user profiles
- Profile statistics
- Community discussions

### Platform

- Authentication
- Responsive design
- SEO metadata
- Dynamic sitemap
- robots.txt generation
- Cookie, privacy, and terms pages

## Project structure

```text
.
├── .env.example
├── public/
│   ├── apple-icon.png
│   ├── favicon.ico
│   ├── google verification file
│   ├── manifest.json
│   └── web-app-manifest-*.png
└── src/
    ├── app/
    │   ├── admin/
    │   ├── appeal/
    │   ├── api/
    │   ├── about/
    │   ├── account/
    │   ├── bookmarks/
    │   ├── categories/
    │   │   └── [category]/
    │   ├── contact/
    │   ├── cookies/
    │   ├── faq/
    │   ├── learn/
    │   ├── privacy/
    │   ├── profile/[username]/
    │   ├── search/
    │   ├── signin/
    │   ├── signup/
    │   ├── terms/
    │   ├── topic/[slug]/
    │   ├── feed.xml/
    │   ├── sitemap.ts
    │   └── robots.ts
    ├── components/
    │   ├── admin/
    │   ├── comments/
    │   ├── layout/
    │   ├── providers/
    │   ├── search/
    │   ├── topic/
    │   └── ui/
    ├── data/
    │   ├── categories.ts (one-time seed source)
    │   └── topics.ts (one-time seed source)
    ├── lib/
    │   ├── content.ts
    │   ├── recommendations.ts
    │   ├── moderation/
    │   ├── supabase/
    │   ├── constants.ts
    │   └── utils.ts
    └── types/
```

## Future plans

Planned features include:

- Premium audio versions of topics; written topic content remains free.
- Structured learning paths.
- Interactive quizzes.
- Guided study experiences.

The focus for now remains on growing the content library and improving the core learning experience.

## Deployment

CathoScroll is deployed on [Vercel](https://vercel.com) and uses [Supabase](https://supabase.com) for authentication, database storage, and user management.

Before deploying, configure the required environment variables in both Vercel and Supabase.

### Supabase database recovery and bootstrap

[`docs/cathoscroll-database-bootstrap.sql`](docs/cathoscroll-database-bootstrap.sql) is the consolidated snapshot of CathoScroll's application-owned PostgreSQL schema. Sponsor organisation access, campaign submissions, invoice records and direct-bank-transfer reconciliation are described in [`docs/sponsor-platform.md`](docs/sponsor-platform.md). It recreates the 40 application tables, constraints, indexes, 98 functions, 33 triggers, RLS configuration and policies, grants, the RLS DDL event trigger, and scheduled retention jobs. It includes the ranked-search setup and current offline-sync protections.

Use this file when creating a **fresh Supabase project** to restore the application schema:

1. Create a new Supabase project using the same PostgreSQL major version as the source project.
2. Open the new project's SQL Editor and run the complete bootstrap file once.
3. Confirm that both retention jobs exist and are succeeding, then verify the RLS policies, function grants, and PostgREST RPCs.
4. The bootstrap already seeds the 15 categories and 86 topics present at export time. Restore any additional or newer content and all required user data from a separate data export.
5. Reconfigure Auth providers and redirect URLs, project secrets, Storage buckets/policies if used, Edge Functions, API settings, and the matching Vercel environment variables.

The bootstrap intentionally refuses to run if CathoScroll application tables already exist. **Do not run it against the existing production project or use it as an upgrade script.** It restores schema and the public category/topic catalogue snapshot, not a full database backup: it does not restore Auth users/passwords, profile records, admin-owner/admin-role assignments, bookmarks, comments, notes, notifications, moderation history, other user-generated rows, Storage objects, Auth settings, API keys, secrets, Edge Functions, or Supabase-managed platform internals. The `profiles` table and its restricted column-level grants are part of the schema bootstrap, but profile rows must be restored separately. This bootstrap is not a substitute for Supabase's managed backups or point-in-time recovery. Use those for full-project recovery where available, and keep a separate, regularly tested backup of database data and project configuration.

This is the single canonical SQL source for rebuilding the application database schema. Update it whenever application database objects change, and test it on a disposable Supabase project before relying on it for disaster recovery. Do not maintain a chain of manually applied SQL patches as a substitute for this snapshot.

## License

This repository does not currently include a license.

All rights are reserved unless permission is granted by the author. Please contact me before reusing, redistributing, or commercially using any part of this project.

---

<div align="center">

Built by [Joshua Argent](https://joshuaargent.vercel.app)

CathoScroll • Learn Catholic teaching one swipe at a time

</div>
