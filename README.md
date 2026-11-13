<div align="center">

# CathoScroll

### Learn Catholic teaching one swipe at a time

Explore Catholic theology, Scripture, Church history, apologetics, prayer, and doctrine through a modern educational experience designed to make learning the faith more accessible and engaging.

[![Website](https://img.shields.io/badge/Website-cathoscroll.vercel.app-0D9488?style=for-the-badge&logo=vercel&logoColor=white)](https://cathoscroll.vercel.app)
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

## Mobile app wrapper

CathoScroll can be packaged for Android and iOS with Capacitor while loading the
website hosted on Vercel. This thin wrapper requires an internet connection and
does not provide offline access to topics or account features.

The wrapper defaults to `https://cathoscroll.vercel.app`. To point it at a
different HTTPS deployment, set `CAPACITOR_SERVER_URL` in the environment used
to run Capacitor commands. Do not set it to an HTTP URL for a production build.

The native projects include branded launch screens. Android fades the launch
screen out as the app opens; iOS uses its required static launch screen.

**This is a remote-site prototype, not a recommended production configuration.**
It uses Capacitor's `server.url`, which Capacitor documents as intended for
live-reload and not production. It is useful for trying the site in native
WebViews, but should not be treated as ready for public app-store distribution.

Install the native platform projects once:

```bash
npx cap add android
npx cap add ios
```

Generate the native app icons and splash screens from the CathoScroll logo, then
synchronize Capacitor and open the platform project:

```bash
npm run assets:generate
npm run cap:sync
npm run cap:open:android
npm run cap:open:ios
```

The source logo is `assets/logo.png`; generated iOS and Android assets are checked
in with their respective native projects. Run the asset generator again whenever
the source artwork changes.

Android builds require Android Studio and its Android SDK. iOS builds require
macOS and Xcode. Re-run `npm run cap:sync` after changing Capacitor configuration
or native plugins. Ordinary website changes continue to deploy through Vercel
and do not require rebuilding the native wrapper.

The local `www/index.html` is only an offline/error message; it does not cache
the application. Test sign-in, email verification, navigation, and external
links on real devices. A production Capacitor app should bundle its web assets;
that would require adapting this server-rendered Next.js app for a compatible
native delivery architecture.

## Desktop app

CathoScroll also has a separate Electron desktop target powered by
Capawesome's maintained Capacitor Electron platform. It reuses the Capacitor
web experience and currently loads the hosted CathoScroll website, so it
requires an internet connection and is not an offline desktop app. The hosted
URL defaults to `https://cathoscroll.vercel.app` and can be overridden with
`CAPACITOR_SERVER_URL` when launching or packaging the desktop app.

After installing the root dependencies with `npm install`, start the desktop
app with:

```bash
npm run desktop:run
```

Create a distributable installer for the current operating system with:

```bash
npm run desktop:package
```

Installers are written under `electron/dist`. Packaging and signing for each
operating system should be tested on that OS before release. The hosted-site
configuration is suitable for development and evaluation, not a final
store-ready release.

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

### Offline app direction

The website remains a server-rendered Next.js application and continues to use Supabase as its online source of truth. The default Capacitor and Electron wrappers load the hosted website and are not offline-capable. The experimental opt-in native build bundles a SQLite catalogue and uses the same feed and swipe viewer as the website. It is not a complete app: navigation, authentication, account activity, comments, notes, content updates and synchronization are not yet available in the preview. It must not be used as a production replacement.

`npm run offline:export` exports published categories and topics into the ignored `build/offline/catalogue.jsonl`, using the public Supabase URL and anonymous key in the process environment. The line-oriented export is paged, has a checksum footer, and replaces the previous export only after a successful run. Changes during export still require reconciliation by a future content-sync protocol.

With Node.js 22.13 or newer, `npm run offline:database` converts that snapshot into `build/offline/catalogue.sqlite`. It verifies the snapshot checksum, counts and category references, builds browse indexes, checks SQLite integrity, and replaces an existing database only after success. `npm run native:build` exports and bundles a fresh snapshot; `npm run native:build:local` uses an existing export. Set `CATHOSCROLL_NATIVE_BUNDLE=1` when synchronizing a native platform to try the experimental build. The separate catalogue and activity databases are currently unencrypted, and the bundled catalogue is not refreshed after installation.

The offline activity store, staged bootstrap and background push/pull scheduler are unconnected building blocks. They preserve queued edits when importing an initial activity snapshot and retry operations without discarding them. They require a server protocol that validates account identity, atomically deduplicates operation IDs and supplies a race-safe snapshot and contiguous per-user revisions. Native authentication, server transport, notes and conflict resolution are not implemented; no background account synchronization occurs yet. Progress timestamps and other account features also need to be preserved before enabling offline activity. Comments and admin actions will require a connection, with an appropriate message when unavailable.

Signed-in feed recommendations require the `get_my_recommendation_page` RPC and supporting indexes supplied separately for Supabase. It aggregates each user's completed topics (weight 5), bookmarks (4), likes (3), and distinct commented topics (3) across the published catalogue into category preferences. For each category, a weight of `1 + sqrt(preference)` reduces the effect of very large histories while allowing every category to be explored. The RPC takes the next unfinished topic from indexed category streams, selecting the category with the smallest `served / weight` and avoiding three consecutive topics from the same category when alternatives exist. This approximates a globally personalized ranking without loading or sorting the whole catalogue. The per-category cursor and preference snapshot are carried across pages; a refresh picks up changed preferences. Progress is checked as pages load, and content edits or unpublishing can change subsequent results. If every topic is complete, the initial page falls back to completed topics. The cursor is limited to 200 published categories and 64 KiB; the RPC rejects larger catalogues explicitly. Recommendation responses are private and uncached. Signed-out users retain the shuffled feed.

The feed viewer requests exact like and visible-comment counts and the signed-in user's activity for the current topic only. It does not download the full likes, comments, bookmarks, or progress tables. Exact counts still require database work proportional to the matching rows; very popular topics may eventually need maintained aggregate counters. Recommendation quality and query performance should be measured with real usage rather than assumed to match large commercial recommendation systems.

| Variable                        | Purpose                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Optional. Canonical site URL used for metadata, sitemap, and feed generation. Defaults to the production URL. |
| `NEXT_PUBLIC_SUPABASE_URL`      | Required. Supabase project URL.                                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required. Supabase publishable/anonymous key used by the client.                                              |
| `NEXT_PUBLIC_FORMSPREE_FORM_ID` | Optional. Formspree form ID for contact form submissions.                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Required for server-side comment moderation, reports, and appeals. Keep secret.                               |

Never put Supabase service-role keys or other server secrets in `NEXT_PUBLIC_*` variables.

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
