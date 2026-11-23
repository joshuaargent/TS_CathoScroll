# Personalisation and analytics implementation

## Purpose separation

CathoScroll has three separate signed-in optional purposes:

- Service improvement analytics measures topic and Top Comments engagement to improve the service.
- Personalisation uses eligible account activity and selected category interests to build a private recommendation profile.
- Sponsor measurement measures signed-in sponsor viewability, clicks, bounded active viewing duration and frequency for campaign reporting.

Personalisation and Service improvement analytics are separately presented choices. Selecting Personalisation automatically enables Service improvement analytics and keeps it enabled while Personalisation is active; users may also enable Service improvement independently. Personalisation uses direct account actions and selected categories under its own explicit consent. Passive reading signals are collected under Service improvement analytics and inform recommendations while Personalisation is enabled. Users must turn off Personalisation before withdrawing Service improvement; Sponsor measurement remains a third separate choice.

## Signal limits

Passive reading signals are capped independently before they are combined, in both the clean-install bootstrap and existing-database upgrade. Per-topic caps are 1.20 for viewable impressions, 1.50 for active duration, 1.50 for swipe depth, 3.00 for completions and 1.50 for return visits. The same individual caps are applied to short-term and long-term decay windows; repeated impressions cannot consume the score budget reserved for other signals. Negative skip evidence has its own bounded score. The combined topic score is capped again after signal combination.

## General feed

The public general feed is not a personalisation profile. It uses public interactions, curated order, recency and category exposure balancing, with signed-in Service improvement aggregates only where the relevant consent permits their use. It does not use anonymous topic/comment analytics, sponsor delivery or sponsor measurement events.

## Personalised feed

The recommendation RPC uses the account's private profile and explicitly selected category interests. Direct account actions are used under Personalisation consent; passive reading signals are included only while Service improvement consent is also active. Withdrawing Service improvement requires Personalisation to be turned off first; the withdrawal then clears native cached personalised pages that may have been ranked using those signals. The profile is not exposed to other users or sponsors. Admin deep-dive reports are aggregate-only and do not return user IDs, session IDs or raw per-user event records. Sponsor activity never contributes to recommendations. Turning Personalisation off stops new recommendation processing and deletes the derived profile and selected interests. The release upgrade clears existing Personalisation consent records and derived profiles, so all existing users return to no choice recorded. Users must explicitly opt in again under Personalisation consent version v6.

Native Android and Electron display previously downloaded server-ranked pages from encrypted offline storage. There is no separate offline recommendation learner. Cached recommendations are subject to existing cache expiry and consent-freshness rules.

## Analytics data boundary

Signed-in Service improvement events and signed-in Sponsor measurement events are separate streams, each requiring explicit opt-in. No anonymous topic/comment events, anonymous sponsor events, served counters, anonymous frequency rows, anonymous retry queues or anonymous analytics tables exist in the final model.

Sponsor delivery remains available to all eligible visitors without measurement. Sponsor viewability/click/frequency reports represent only signed-in users who opted into Sponsor measurement and must not be extrapolated to total deliveries or audience reach.

## Release checks

- Verify recommendation signals are processed only after Personalisation consent.
- Verify Service improvement analytics and Sponsor measurement remain purpose-specific and withdrawal-safe.
- Verify no sponsor event or campaign selection affects organic ranking.
- Verify no topic/category identifiers enter sponsor measurement payloads.
- Verify native offline cache does not learn or update a profile while offline.
- Verify anonymous analytics and sponsor delivery counters remain absent from code, SQL, admin/sponsor UI and tests.


### Withdrawal and recomputation

Service improvement withdrawal deletes raw topic and Top Comments events and viewer-bridge rows for that account, rebuilds recent daily aggregates from the remaining opted-in event records, and refreshes the recommendation profile without passive reading signals. Direct account actions and selected categories remain available to Personalisation while it is enabled. Sponsor measurement withdrawal deletes the account's sponsor event records and placement receipts and rebuilds recent campaign aggregates without that account's events.
