# Personalisation and analytics implementation

## Purpose separation

CathoScroll has three separate signed-in optional purposes:

- Service improvement analytics measures topic and Top Comments engagement to improve the service.
- Personalisation uses eligible account activity and selected category interests to build a private recommendation profile.
- Sponsor measurement measures signed-in sponsor viewability, clicks and frequency for campaign reporting.

These purposes must not be silently combined. The current UI automatically enables Service improvement analytics while Personalisation is enabled. If the controller treats them as distinct purposes, this is a consent-granularity risk and must be separated before release or supported by a documented legal assessment. Sponsor measurement remains a separate choice.

## General feed

The public general feed is not a personalisation profile. It uses public interactions, curated order, recency and category exposure balancing, with signed-in Service improvement aggregates only where the relevant consent permits their use. It does not use anonymous topic/comment analytics, sponsor delivery or sponsor measurement events.

## Personalised feed

The recommendation RPC uses the account's private post-consent profile and explicitly selected category interests. The profile is not exposed to other users or sponsors. Admin deep-dive reports are aggregate-only and do not return user IDs, session IDs or raw per-user event records. Sponsor activity never contributes to recommendations. Turning Personalisation off stops new recommendation processing and deletes the derived profile and selected interests. Existing v3 grants are withdrawn by the v4 upgrade; affected users must explicitly opt in again under the current consent version.

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
