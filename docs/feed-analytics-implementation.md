# Feed analytics implementation notes

**Status:** Phase 1 foundation implemented on `feature/feed-analytics-foundation`.

## Scope of this phase

This phase adds a private, authenticated, bounded event pipeline for the existing topic feed. It deliberately does not redesign TopicCard, change feed ordering, add sponsor placements, add comment cards, or change the current recommendation RPC. Those are later phases and will consume the event foundation.

## Database

The production Supabase project has an additive migration named `create_feed_analytics_foundation`, followed by `fix_feed_analytics_event_validation` and `harden_feed_analytics_payload_validation`.

Objects:
- `catho_private.feed_analytics_events`: append-only raw topic-feed events.
- `catho_private.feed_analytics_event_limits`: per-user database-enforced ingestion counter.
- `public.record_feed_analytics_events(jsonb)`: authenticated batch RPC.

Raw event rows are inaccessible through the Data API. The RPC derives the user from `auth.uid()`; clients cannot choose another user's ID. The RPC validates batch size, event IDs, session IDs, event type, entity type, published topic ownership, metadata keys and bounds. Event IDs are unique per user, so retrying a batch is idempotent. Server receipt time is authoritative; client timestamps are not accepted.

The initial event vocabulary is impression, viewable impression, active duration, skip, swipe depth, completion and return visit. Only published topic entities are accepted in this phase. The event vocabulary and table are intentionally ready to be extended for comments, sponsors and quizzes when those entity models are implemented.

Limits:
- At most 50 events per request.
- At most 16 KiB per request.
- At most 120 submitted events per user per minute at the database layer.
- A separate shared API rate limit also applies to the HTTP endpoint.

## HTTP ingestion

`POST /api/analytics/feed-events` is authenticated and accepts same-origin website requests or the existing trusted native-app bearer-token flow. It uses bounded JSON parsing, private/no-store responses and the existing shared PostgreSQL API rate limiter. Analytics failures are non-fatal to the feed and are not coupled to bookmark, like, comment, progress or offline activity writes.

## Client instrumentation and queue

The existing topic swipe viewer now records signed-in topic impressions, viewability-qualified impressions, active visible duration, early skips, slide depth, completion and repeat visits. The existing TopicCard UI, five-slide content, swipe directions, like/bookmark/comment actions and topic ordering are unchanged.

The browser client batches up to 50 events. A bounded localStorage queue is namespaced by the currently authenticated user ID so pending events from one account cannot be attributed to another account after a sign-out/sign-in switch. Events contain no comment text, profile details, email addresses or raw user identifiers. Queue writes and network failures are best-effort; they never block feed navigation or learning actions.

The queue is retried when connectivity returns and flushed on page hide/visibility changes. It is capped at 200 events per account; when full, the oldest unsent telemetry is discarded to keep storage bounded. Browser storage can be cleared by the user or the operating system, and abrupt process termination can still lose events that have not reached the server. This is analytics telemetry, not the durable offline activity outbox. A later native-specific phase should decide whether telemetry belongs in encrypted SQLite or remains best-effort.

A viewable impression requires at least 50% of the feed container to remain visible for one continuous second. Active duration is measured only while the document is visible and the feed container is viewable. It is emitted in bounded chunks. The client does not send client timestamps; the server receipt time is used for reporting.

## Privacy and reporting

The initial implementation tracks signed-in feed usage only. Anonymous tracking is not enabled. Raw events are private and should be exposed only through server-side administrator aggregate queries. Sponsor dashboards must never expose individual user identities or raw events.

No historical impressions or reading duration can be inferred from likes, bookmarks or comments. Those older metrics must be shown as unavailable, not zero. Raw event data is retained for 180 days; a bounded cleanup job runs every 15 minutes and deletes up to 5,000 expired rows per run. Daily aggregate rollups are not implemented yet, so reporting beyond the raw retention window is not yet available. Topic/category dashboards, comment and sponsor events, and recommendation weighting are separate follow-up phases.

## Verification still required

- Run repository lint, TypeScript, unit tests and production build.
- Add tests for event payload validation, duplicate IDs, per-user isolation, offline queue recovery and batch retry.
- Confirm the RPC grants and private table privileges in Supabase.
- Inspect Supabase security/performance advisors.
- Verify ingestion from website and Android/Electron native origins.
- Decide and implement a documented raw-event retention period before collecting material production volume.
