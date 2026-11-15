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
git clone https://github.com/joshuaargent/CathoScroll.git
cd CathoScroll
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

Create and push an annotated version tag from the merged `main` commit. For example, for version 2.2.0:

```bash
git checkout main
git pull origin main
git tag -a v2.2.0 -m "CathoScroll v2.2.0"
git push origin v2.2.0
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

## Configuration

Copy `.env.example` to `.env.local` in the project root and fill in the values for your project. `.env.local` is ignored by Git; commit changes to `.env.example` when the required variables change, never your real credentials.

## Authentication and protected pages

The `/account` and `/bookmarks` pages have two layers of sign-in checks:

1. The Next.js 16 `src/proxy.ts` layer validates the Supabase session and redirects signed-out requests to `/signin`, preserving the requested local path so sign-in can return the user to it.
2. The account page repeats the check client-side, and the bookmarks page checks the session on the server before reading user data.

These redirects improve navigation but do not replace authorization. Supabase Row Level Security policies and server-side checks must continue to protect user data and mutations. The moderation dashboard and moderation API routes independently verify the signed-in user's database-backed admin role; hiding admin UI is never treated as authorization.

### Supabase write-permission hardening

Before deploying the matching application changes, apply the corresponding SQL directly in the Supabase SQL Editor. It removes client write access to profile subscription tiers and comment pin state, while allowing authenticated users to create/update only the profile and comment fields used by the app. New profiles default to the free tier. No Supabase migration files are maintained in this repository.

Comment pinning and moderation use server endpoints and a database-backed `admin_users` role table. The service-role key is used only on the server and must never be exposed in a `NEXT_PUBLIC_*` variable. Add admin membership and the moderation tables, constraints, comment-ban insert/edit triggers, atomic moderation functions, and report throttling function using the SQL supplied by the project maintainer; no Supabase migration files are maintained in this repository.

Authenticated users can privately report comments. Admins can review and dismiss reports, resolve them, or hide the reported comment. Comment restrictions prevent new comments, replies, and edits, but do not disable sign-in or other account features; users can still delete their own comments. Admins may optionally hide a user's existing visible comments when applying a restriction, while retaining them in moderation history. Restricted users can submit one pending appeal; admins can review paginated comment history with reply context and lift the restriction. Subscription tiers must only be changed by trusted billing/server-side code.

The notification center is available to signed-in users from the navbar bell. It displays the latest 50 notifications and supports marking one or all as read; the badge shows `1`–`9`, then `9+`, and is hidden when there are no unread notifications. Apply the notification table, owner-only RLS policies, and database notification triggers/functions from the SQL supplied by the project maintainer before enabling this feature. Those database-side handlers create welcome, reply, and moderation notifications transactionally; email notifications are not used.

### Database-backed topics and recommendations

Topics and categories are read from the public `topics` and `categories` tables. The initial catalog has been imported into Supabase; new and updated content should be managed in the database. Topic IDs and URL slugs remain stable after creation because user activity and external links may refer to them.

Public category, topic-detail, topic-page, topic-count, and topic-by-ID reads use a five-minute tagged server cache. Feed and category browsing use keyset pagination (50 topics per request), and topic detail loads only its neighbors and a few related topics. Search is server-side and returns at most 30 ranked results using the `topics.search_vector` GIN index and `search_published_topics` RPC; apply the matching SQL setup before deploying that search change. Sitemap generation is split into bounded files. RSS contains the 50 most recently created published topics, rather than the whole catalogue; creation time is not necessarily publication time. Admin content updates invalidate the tagged content cache. This improves the website's data-query and response behavior as the catalogue grows; it is not an offline copy.

Admins can create and edit categories and topics from `/admin/content`, including descriptions, Catechism and Scripture fields, ordering, and publication status. Unpublishing archives content without deleting rows or breaking user activity. Topic IDs and slugs and category slugs are fixed after creation. Admins can grant another user administrator access from that user's profile; role changes are handled server-side and cannot be self-granted through this action.

### Offline apps and synchronization

The website remains server-rendered and Supabase is the online source of truth.
The bundled Android and Electron apps support offline feed, topic, category and
local substring search. When online, search uses the website's ranked search RPC;
if it is unavailable, the app reports the problem and searches saved topics.
Local search scans catalogue text and is not optimized for very large catalogues.
The installed Supabase project must have the website's `search_published_topics`
RPC for ranked search to work. The native app bundles the same font subsets as
the website, including their Open Font License notices in `native/fonts`.

`npm run native:build` exports the published catalogue using the public
Supabase configuration from `.env.local` or the environment. The export checks
server counts and revision before replacing its previous snapshot, and
`offline:database` verifies its checksum and SQLite integrity. A changing or
incomplete export fails rather than packaging partial content.
`native:build:local` uses an existing export and is intended for local testing.
The Supabase offline sync and scheduled-pruning SQL supplied separately have
been installed. Monitor the cleanup jobs for successful runs. RLS stays enabled
on the public sync tables without granting direct access.

The app stages incremental catalogue changes and publishes them atomically. It
falls back to a checked full snapshot if history expires or a reset is needed.
Interrupted updates leave the previous catalogue intact. The catalogue checksum
and timestamp describe the original bundled import, while counts reflect the
current local catalogue.

Account activity, cached comments, topic counts, and encrypted note records are
stored in the encrypted private database. Bootstrap and history-expiry recovery
stage snapshots before publication, preserving pending edits. The server
acknowledges device sequences to safely discard older write receipts. A rejected
unavailable topic is retained and reported without blocking later edits.
Legacy activity and cache tables are copied transactionally, then the encrypted
database is checked for integrity and its migration marker is verified before
the plaintext database and SQLite sidecars are removed. Android backup and
device-transfer rules exclude both current and legacy private activity files.
Electron removes both legacy activity database locations after verification;
if cleanup fails, the private store remains usable and cleanup is retried on the
next launch. Existing catalogue databases are checked on startup; a damaged
catalogue is rebuilt from a validated bundled snapshot without touching private
user data. Incremental catalogue refreshes compare the published category set
so unpublished or deleted categories cannot remain in the offline cache.
Electron copies legacy databases out of Chromium's managed directory when
possible, but cannot recover data Chromium already removed.

Sign-in, sign-up and profile changes require a connection. Sessions use
Android Keystore-backed storage or Electron's operating-system secure storage.
Signing out requires a connection and is blocked while activity is queued.
Encryption keys are device-specific and excluded from Android backup;
unsynchronized changes cannot be expected to transfer to another device.

Previously fetched comment discussions and counts can be read offline but may
be incomplete or stale. Comment writes remain online-only. Notes can be edited
online after the latest note has loaded; notes opened online are cached for
read-only offline access. The latest 50 notifications and their unread count
are stored in the encrypted account database. Notifications must first be
loaded online; read changes made offline are queued and synced after reconnect.
Marking all as read offline covers notifications known to that device, not
notifications received afterwards. Reporting and moderation require an internet connection; native administrators can use the same moderation workflows as the website.
Real-device upgrades, reconnects and packaged desktop releases still need
end-to-end verification before distribution. Windows NSIS and Linux AppImage
updates download in the background and install on app exit. Linux DEB updates
also download automatically, but applying them requires system authorization
through the package installer. macOS remains unsigned and uses a manual
download-and-reinstall update flow.

Signed-in feed recommendations require the `get_my_recommendation_page` RPC and supporting indexes supplied separately for Supabase. It aggregates each user's completed topics (weight 5), bookmarks (4), likes (3), and distinct commented topics (3) across the published catalogue into category preferences. For each category, a weight of `1 + sqrt(preference)` reduces the effect of very large histories while allowing every category to be explored. The RPC takes the next unfinished topic from indexed category streams, selecting the category with the smallest `served / weight` and avoiding three consecutive topics from the same category when alternatives exist. This approximates a globally personalized ranking without loading or sorting the whole catalogue. The per-category cursor and preference snapshot are carried across pages; a refresh picks up changed preferences. Progress is checked as pages load, and content edits or unpublishing can change subsequent results. If every topic is complete, the initial page falls back to completed topics. The cursor is limited to 200 published categories and 64 KiB; the RPC rejects larger catalogues explicitly. Recommendation responses are private and uncached. Signed-out users retain the shuffled feed.

The feed viewer requests exact like and visible-comment counts and the signed-in user's activity for the current topic only. It does not download the full likes, comments, bookmarks, or progress tables. Exact counts still require database work proportional to the matching rows; very popular topics may eventually need maintained aggregate counters. Recommendation quality and query performance should be measured with real usage rather than assumed to match large commercial recommendation systems.

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

## License

This repository does not currently include a license.

All rights are reserved unless permission is granted by the author. Please contact me before reusing, redistributing, or commercially using any part of this project.

---

<div align="center">

Built by [Joshua Argent](https://joshuaargent.vercel.app)

CathoScroll • Learn Catholic teaching one swipe at a time

</div>
