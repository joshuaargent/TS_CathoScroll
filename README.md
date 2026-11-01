<div align="center">

# CathoScroll

### Learn Catholic teaching one swipe at a time

Explore Catholic theology, Scripture, Church history, apologetics, prayer, and doctrine through a modern educational experience designed to make learning the faith more accessible and engaging.

[![Website](https://img.shields.io/badge/Website-CathoScroll-0D9488?style=for-the-badge&logo=vercel&logoColor=white)](https://cathoscroll.com)
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
- **Audio lessons** - planned narrated audio versions of topics.
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

- Node.js 20 or newer
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

## Configuration

Copy `.env.example` to `.env.local` in the project root and fill in the values for your project. `.env.local` is ignored by Git; commit changes to `.env.example` when the required variables change, never your real credentials.

| Variable                        | Purpose                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Optional. Canonical site URL used for metadata, sitemap, and feed generation. Defaults to the production URL. |
| `NEXT_PUBLIC_SUPABASE_URL`      | Required. Supabase project URL.                                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required. Supabase publishable/anonymous key used by the client.                                              |
| `NEXT_PUBLIC_FORMSPREE_FORM_ID` | Optional. Formspree form ID for contact form submissions.                                                     |

Never put Supabase service-role keys or other server secrets in `NEXT_PUBLIC_*` variables.

## Features

### Learning Experience

- Infinite topic feed
- Category browsing
- Full-text search
- Topic bookmarking
- Progress tracking
- Learning streaks

### Community

- Comments and replies
- Comment likes
- Pinned comments
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
    │   ├── comments/
    │   ├── layout/
    │   ├── providers/
    │   ├── search/
    │   ├── topic/
    │   └── ui/
    ├── data/
    │   ├── categories.ts
    │   └── topics.ts
    ├── lib/
    │   ├── supabase/
    │   ├── constants.ts
    │   └── utils.ts
    └── types/
```

## Future plans

Planned premium features include:

- Audio versions of topics.
- Structured learning paths.
- Interactive quizzes.
- Guided study experiences.

The focus for now remains on growing the content library and improving the core learning experience.

## Deployment

CathoScroll is deployed on Vercel and uses Supabase for authentication, database storage, and user management.

Before deploying, configure the required environment variables in both Vercel and Supabase.

## License

This repository does not currently include a license.

All rights are reserved unless permission is granted by the author. Please contact me before reusing, redistributing, or commercially using any part of this project.

---

<div align="center">

Built by Joshua Argent

CathoScroll • Learn Catholic teaching one swipe at a time

</div>
