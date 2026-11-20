# Native offline capability audit

Audit baseline: PR #22 head 3989c239 (20 November 2026).

This audit distinguishes offline browsing, offline reads, local mutation queues and server synchronisation. A cached screen is not evidence that its underlying operation is synchronised.

## Findings

| Capability | Current implementation | Offline status | Notes |
|---|---|---|---|
| Topic catalogue | Packaged SQLite catalogue, incremental catalogue refresh | Available | Native app can browse its packaged/cached catalogue without a network connection. |
| General feed | Server-ranked when online; latest downloaded server-ranked pages cached in catalogue SQLite | Ranked offline where cached | Cache preserves the last server-computed ordering; it does not recalculate global scores offline. If no cached page exists, fall back to catalogue order. |
| Personalised feed | Server-ranked pages cached by cursor in the encrypted private database; last successful consent check cached for 12 hours | Previously downloaded ranked pages available offline on Android/Electron | This reuses server-computed page order; it does not recompute or infer a new profile offline. Expired consent cache, withdrawal, account switch or missing page falls back to general ranking. |
| Likes, bookmarks, completion | Private activity SQLite store, durable outbox, revision/cursor reconciliation | Available on supported encrypted-storage platforms | Activity sync is account-linked and separate from analytics. |
| Signed-in topic/comment exposure analytics | Encrypted private SQLite outbox (2,000 events per stream/account, seven-day expiry, server acknowledgement) on Android and Electron; memory-only on web | Durable on Android/Electron; best effort on web | Separate from activity sync. Account-scoped rows are cleared on sign-out/account switch. |
| Signed-in sponsor event analytics | Separate bounded account-scoped queue | Best effort only | Sponsor delivery/viewability/click reporting is separate from topic/comment analytics and offline activity sync. |
| Activity encryption | SQLCipher-backed private DB on Android; desktop private DB on Electron | Available for this release on Android and Electron | iOS is not part of this release. Private account data must never fall back to the unencrypted catalogue DB. |
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

The queue is intentionally not encrypted because its schema excludes account-linked or private profile data. It is separate from the encrypted signed-in activity database, signed-in analytics, and sponsor delivery/frequency records. The web client retains its existing in-memory queue; this outbox is installed by the Capacitor/Electron entry point. The Cookie Policy provides a free anonymous topic/comment analytics opt-out; disabling it clears pending native rows and prevents further collection. Re-enabling first clears any stale rows before new events can be queued.

## Personalisation offline decision

The native app now caches only server-ranked personalised pages, keyed by account and server cursor, in the encrypted private database. A successful online consent check is cached for 12 hours. This allows previously downloaded pages to be read offline without creating a second ranking algorithm or copying the derived interest profile into local storage. It does not calculate new personalised rankings offline.

Do not persist a derived religious-interest profile in the public catalogue database. Do not treat a stale cached consent flag as current consent after an offline account switch or withdrawal on another device. For this Android/Electron release, personalised feed pages are stored only in the encrypted private database, scoped to the account, with a 12-hour consent freshness limit and deletion on local withdrawal/account switch. iOS is out of scope for this release.

Offline personalisation is limited to previously downloaded pages while the local consent check remains fresh. After 12 hours, on withdrawal, account change, or when the next page was not downloaded, the app falls back to the cached server-ranked general feed, then catalogue order.

## Notes decision

No offline note-editing queue is proposed. The existing design caches only server-confirmed notes, encrypts their content with AES-GCM, stores the key in native secure storage, and requires an online verified account session before saving. This avoids local write conflicts and unverified drafts across account switches. The existing read-only offline behaviour is retained.

## Release acceptance still required

- Verify both native analytics outboxes on Android and Electron: queue events offline, force-close the app, reopen online, confirm upload and acknowledgement.
- Verify retry after HTTP 429/network failure and duplicate server receipts.
- Verify queue cap and seven-day expiry.
- Confirm signed-out analytics never acquire an account/session/visitor ID and remain separate from sponsor reporting.
- Verify offline catalogue browsing and cache freshness on each platform.
- Verify encrypted private activity, notes and signed-in analytics outbox behaviour on Android and Electron.
- Verify personalisation consent/withdrawal online, the 12-hour consent freshness limit, encrypted page-cache isolation, and general-ranked fallback.
- Complete the existing feed visual/navigation and sponsor acceptance matrix before making the PR ready for review.


## Implementation status

- Persistent native anonymous analytics outbox implementation is committed on PR #22. The client persists before uploading, batches 40 events, retries after connectivity/foreground events, acknowledges only server-accepted IDs, and uses volatile memory fallback only if local persistence itself fails.
- Exact branch head at audit update: 3d96d10532f145ac353a759431a3095deae82c07.
- Automated validation for this exact head and native force-close/reconnect testing are pending. The implementation must not be treated as release-verified until those checks pass.


Implementation and privacy documentation were updated through commit f7c18d97a01c3f239158bf6b4644825074ff9b15. The native analytics preference is stored as a local setting only; it is not an analytics identifier. The controller must record the PECR Schedule A1 assessment before release. Automated checks and device-level outbox acceptance remain pending.


## Important sync distinction

The signed-in *activity* outbox for likes, bookmarks and completion is durable on supported encrypted-storage platforms. The signed-in *analytics exposure* queues for topics and Top Comments now use a separate encrypted SQLite outbox on Android and Electron, with account-scoped cleanup. This is distinct from the revision-aware activity sync and does not replace it. The website retains in-memory analytics queues. iOS is outside this release scope.


The native outbox installs reconnect and foreground listeners during native startup, not only after a new feed event. This ensures a queue left by a previous app process can upload after connectivity returns even if the user has not yet opened a feed card.
