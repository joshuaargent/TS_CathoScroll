# Feed and sponsor analytics implementation

## 1. Collection model

CathoScroll does not collect anonymous analytics. Signed-out visitors and signed-in users who have not opted into a relevant purpose generate no topic/comment engagement events, sponsor viewability/click/frequency events, delivery counters or anonymous retry records.

The optional streams are:
- **Service improvement analytics:** signed-in topic and Top Comments engagement, only while the account holder has explicitly enabled it.
- **Sponsor measurement:** signed-in sponsor viewability, clicks and frequency, only while the account holder has separately and explicitly enabled it.
- **Personalisation:** a separate private recommendation purpose, subject to its own explicit opt-in.

Sponsor delivery is independent of Sponsor measurement. Campaign selection and display remain available to all eligible visitors, but unmeasured delivery is not recorded or counted.

## 2. Signed-in feed events

The signed-in topic and Top Comments clients check the account-specific Service improvement consent before creating or uploading events. The ingestion routes independently verify the authenticated account and stored consent. Event payloads are bounded and validated; server-side deduplication prevents retry inflation.

Topic and comment activity may reveal or permit inference of religious or philosophical beliefs. Treat it as potentially special-category data where the processing intentionally reveals, infers or uses those beliefs. Restrict access and use only for the disclosed service-improvement purpose.

## 3. Signed-in queue behaviour

Website pending queues are memory-only. Android and Electron use encrypted, account-scoped SQLite outboxes for opted-in signed-in streams only. Each stream is capped at 2,000 pending events and seven days. Events are removed after server acknowledgement. Withdrawal immediately blocks local collection, clears the matching stream and prevents further upload; account changes clear the previous account's queues.

No anonymous client, anonymous API route, anonymous retry queue, anonymous native SQLite outbox or anonymous preference control is part of the intended architecture.

## 4. Sponsor measurement

SponsorFeedCard records a viewable impression only after the configured IntersectionObserver threshold and visible-time threshold are met, and records a click only after an eligible viewable impression. The client sends only when a signed-in account has enabled Sponsor measurement. The server independently checks account consent and campaign eligibility.

Sponsor event payloads contain campaign ID, event ID, session/placement ID and event type. They must not include topic IDs, category IDs, reading histories or recommendation-profile fields. Sponsor measurement is never used for organic ranking or sponsor targeting based on religious interests.

Only opted-in viewable impressions and clicks are aggregated for sponsor/admin reporting. Frequency limits for measured users are derived from their opted-in viewable-impression event history. No served event is created. For visitors without consent, delivery selection does not create a count, session token, frequency row, event receipt or daily aggregate.

Campaign daily/total impression caps, where configured, apply only to opted-in viewable impressions. They do not measure or limit all sponsor deliveries. The user-facing campaign-management copy must state this limitation.

## 5. Ranking and feed behaviour

The general ranking uses public interactions, curated order, recency, category exposure balancing and only the signed-in Service improvement aggregates permitted by consent. It does not query anonymous analytics tables or sponsor events. Sponsor delivery never changes organic ranking.

Top Comments and sponsor placement cadence remain independent of analytics consent. A visitor who declines analytics still sees the same feed features and eligible sponsor placements.

## 6. Native/offline behaviour

Native apps do not persist anonymous analytics because none is collected. The signed-in analytics outboxes remain separate from the account activity-sync outbox. Offline recommendation pages use the existing encrypted cache of previously downloaded server-ranked content; there is no separate offline learning algorithm.

## 7. Database and release checks

The canonical database bootstrap and existing-database upgrade remove anonymous analytics functions, tables, receipts, cron jobs and sponsor delivery aggregates. The sponsor selectors do not write served counters. The event ledger accepts only consented viewable-impression and click events.

Before release, run the full unit/integration suite, type-check, lint, production build, Android/Electron builds, SQL review and independent code review. Verify that no anonymous API, client import, native store, admin metric, sponsor portal metric or ranking query remains.
