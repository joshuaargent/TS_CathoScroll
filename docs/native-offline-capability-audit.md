# Native offline capability audit

Audit baseline: PR #22 head 3989c239 (20 November 2026).

This audit distinguishes offline browsing, offline reads, local mutation queues and server synchronisation. A cached screen is not evidence that its underlying operation is synchronised.

## Findings

| Capability | Current implementation | Offline status | Notes |
|---|---|---|---|
| Topic catalogue | Packaged SQLite catalogue, incremental catalogue refresh | Available | Native app can browse its packaged/cached catalogue without a network connection. |
| General feed | Server-ranked when online; local catalogue order when offline | Available with fallback | Offline fallback is not the same ranking as the online general feed. |
| Personalised feed | Consent status and recommendation pages fetched from Supabase RPC | Not implemented offline | Offline startup currently uses the local catalogue and explicitly disables personalised-feed status. No local recommendation profile or native equivalent of the server ranking is present. |
| Likes, bookmarks, completion | Private activity SQLite store, durable outbox, revision/cursor reconciliation | Available on supported encrypted-storage platforms | Activity sync is account-linked and separate from analytics. |
| Activity encryption | SQLCipher-backed private DB on Android; desktop private DB on Electron | Platform-limited | iOS currently has no equivalent encrypted private database/keychain-backed implementation in this path. The app must not silently move account activity or recommendation profiles into the unencrypted catalogue DB. |
| Notes | Encrypted note cache; fetched from server online; edits require a verified online load and a live connection | Offline read where secure cache is supported; editing online-only | No offline edit queue is needed. Notes use AES-GCM with a key in native secure storage and account/topic-bound HMAC indexes. |
| Comments | Public comment cache in local SQLite | Cached read | Comment creation/replies/likes require live server actions; cached comments are snapshots and can be stale. |
| Topic counts | Local cache refreshed online | Cached read | Counts are explicitly freshness-aware. |
| Profile details | Private profile cache and online refresh | Cached read where private DB works | Profile/account mutations require connectivity. |
| Personalisation settings | Read/write via authenticated RPC | Online only | Consent and explicit category interests are not locally cached for offline recommendation. |
| Sponsor placements | Server-selected placements and server-side delivery attribution | Online only | Do not manufacture served/viewable/click receipts offline. |
| Anonymous feed analytics | Previously in-memory retry queue | Best effort only at audit baseline | This follow-up adds a persistent native outbox. |
| Sponsor analytics | Separate sponsor event client and anonymous session frequency handling | Separate transport | Do not merge with topic/comment analytics or account activity sync. |
| Admin/moderation/security | Server-authorised mutations | Online only | This is intentional; privileged state changes must not be replayed blindly from an offline queue. |

## Signed-out analytics durability follow-up

The native app now uses a SQLite outbox in the public catalogue database for signed-out topic and Top Comments events. These records contain only event UUIDs, public entity IDs, event types, bounded duration values and local creation timestamps. They contain no user, account, visitor or session identifier.

The outbox accepts only the existing anonymous topic/comment event schema, deduplicates by event UUID, retains at most 2,000 events, expires unsent events after seven days, uploads batches of 40 when online or when the app returns to the foreground, retains failed and rate-limited batches, and deletes acknowledged events only after a successful server response. Server-side event receipt deduplication makes retries safe if the server accepted a batch but the client did not receive the acknowledgement.

The queue is intentionally not encrypted because its schema excludes account-linked or private profile data. It is separate from the encrypted signed-in activity database, signed-in analytics, and sponsor delivery/frequency records. The web client retains its existing in-memory queue; this outbox is installed by the Capacitor/Electron entry point.

## Personalisation offline decision

A true offline personalised feed needs an offline-safe, account-scoped profile containing the signals and explicit category choices required by the ranking model, plus a verified consent lifecycle. The current app does not have that. The server model also uses decaying telemetry and distinct-session signals that are not fully represented in the local activity store.

Do not persist a derived religious-interest profile in the public catalogue database. Do not treat a stale cached consent flag as current consent after an offline account switch or withdrawal on another device. Implementing this safely requires encrypted private storage and secure key lifecycle on iOS as well as Android and Electron; a versioned minimal account-scoped recommendation snapshot; a consent-version/revocation check with conservative fallback; local ranking parity tests; and reconciliation that never lets local approximations overwrite server-authoritative state.

Until those conditions exist, native offline mode should continue to show the cached general catalogue rather than claim to provide personalised recommendations.

## Notes decision

No offline note-editing queue is proposed. The existing design caches only server-confirmed notes, encrypts their content with AES-GCM, stores the key in native secure storage, and requires an online verified account session before saving. This avoids local write conflicts and unverified drafts across account switches. The existing read-only offline behaviour is retained.

## Release acceptance still required

- Verify the native outbox on Android, iOS and Electron: queue events offline, force-close the app, reopen online, confirm upload and acknowledgement.
- Verify retry after HTTP 429/network failure and duplicate server receipts.
- Verify queue cap and seven-day expiry.
- Confirm signed-out analytics never acquire an account/session/visitor ID and remain separate from sponsor reporting.
- Verify offline catalogue browsing and cache freshness on each platform.
- Verify encrypted private activity/note behaviour on Android and Electron; confirm iOS remains explicitly unsupported rather than silently writing private data to plaintext storage.
- Verify personalisation consent/withdrawal online and confirm offline mode falls back to general catalogue.
- Complete the existing feed visual/navigation and sponsor acceptance matrix before making the PR ready for review.
