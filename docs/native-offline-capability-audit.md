# Native offline capability audit

Audit baseline: PR #22, native 2.4.0 release preparation (20 November 2026).

This audit distinguishes offline browsing, offline reads, local mutation queues and server synchronisation. A cached screen is not evidence that its underlying operation is synchronised.

## Findings

| Capability | Current implementation | Offline status | Notes |
|---|---|---|---|
| Topic catalogue | Packaged SQLite catalogue, incremental catalogue refresh | Available | Native app can browse its packaged/cached catalogue without a network connection. |
| General feed | Server-ranked when online; latest downloaded server-ranked pages cached in catalogue SQLite | Ranked offline where cached | Cache preserves the last server-computed ordering; it does not recalculate global scores offline. If no cached page exists, fall back to a shuffled local catalogue page. |
| Personalised feed | Server-ranked pages cached by cursor in the encrypted private database; consent state cached for 12 hours | Previously downloaded ranked pages available offline on Android/Electron | This reuses server-computed page order; it does not recompute or infer a new profile offline. The `activity-signals-v4` cache marker invalidates pages ranked under older models. Expired consent cache, withdrawal, account switch, model-version change or missing page falls back to general ranking. This v4 invalidation is in PR #40 and is not live until the matching app/SQL release.
| Likes, bookmarks, completion | Private activity SQLite store, durable outbox, revision/cursor reconciliation | Available on supported encrypted-storage platforms | Activity sync is account-linked and separate from analytics. |
| Signed-in topic/comment exposure analytics | Encrypted private SQLite outbox (2,000 events per stream/account, seven-day expiry, server acknowledgement) on Android and Electron; memory-only on web | Durable on Android/Electron; best effort on web | Separate from activity sync. Account-scoped rows are cleared on sign-out/account switch. |
| Signed-in sponsor event analytics | Encrypted private SQLite outbox (2,000 events per stream/account, seven-day expiry, server acknowledgement) on Android and Electron | Durable on Android/Electron; best effort on web | Separate stream in the same encrypted outbox; account-scoped rows are cleared on sign-out/account switch. Signed-out sponsor delivery creates no session token, event receipt or per-visitor frequency record. |
| Activity encryption | SQLCipher-backed private DB on Android; desktop private DB on Electron | Available for this release on Android and Electron | iOS is not part of this release. Private account data must never fall back to the unencrypted catalogue DB. |
| Notes | Encrypted note cache; fetched from server online; edits require a verified online load and a live connection | Offline read where secure cache is supported; editing online-only | No offline edit queue is needed. Notes use AES-GCM with a key in native secure storage and account/topic-bound HMAC indexes. |
| Comments | Public comment cache in local SQLite | Cached read | Comment creation/replies/likes require live server actions; cached comments are snapshots and can be stale. |
| Topic counts | Local cache refreshed online | Cached read | Counts are explicitly freshness-aware. |
| Profile details | Private profile cache and online refresh | Cached read where private DB works | Profile/account mutations require connectivity. |
| Personalisation settings | Account identity is read from the locally persisted session; consent state is cached in the encrypted private database for 12 hours | Native withdrawal can be queued offline; enabling personalisation and editing explicit categories remain online | A fresh Account-page load can read cached consent. If no fresh state exists, the user can force a local personalisation denial; it is synchronised when connectivity returns. Withdrawal clears cached personalised pages. Explicit category settings and derived interest scores are not copied into the public catalogue database. |
| Sponsor placements | Server-selected placements and server-side delivery attribution | Online only | Do not manufacture served/viewable/click receipts offline. |
| Anonymous feed analytics | Separate anonymous native SQLite outbox (2,000 events, seven-day expiry, objection and acknowledgement deletion); website remains in memory | Durable native retry | Contains no account, visitor or session identifier and is not stored in the encrypted account database. The objection control is a proposed PECR safeguard and remains pending product/controller approval. |
| Sponsor analytics | Signed-in opted-in sponsor events use a separate account-scoped stream; signed-out delivery records campaign/day served totals only | Separate transport | Signed-out visitors have no session token, event-level viewability/click record or per-visitor frequency tracking. Do not merge sponsor analytics with topic/comment analytics or account activity sync. |
| Admin/moderation/security | Server-authorised mutations | Online only | This is intentional; privileged state changes must not be replayed blindly from an offline queue. |

## Signed-out analytics durability follow-up

The native app now uses a SQLite outbox in the public catalogue database for signed-out topic and Top Comments events. These records contain only event UUIDs, public entity IDs, event types, bounded duration values and local creation timestamps. They contain no user, account, visitor or session identifier.

The outbox accepts only the existing anonymous topic/comment event schema, deduplicates by event UUID, retains at most 2,000 events, expires unsent events after seven days, uploads batches of 40 when online or when the app returns to the foreground, retains failed and rate-limited batches, and deletes acknowledged events only after a successful server response. Server-side event receipt deduplication makes retries safe if the server accepted a batch but the client did not receive the acknowledgement.

The queue is intentionally not encrypted because its schema excludes account-linked or private profile data. It is separate from the encrypted signed-in activity database, signed-in analytics, and sponsor delivery/frequency records. The web client retains its existing in-memory queue; this outbox is installed by the Capacitor/Electron entry point. The current branch includes a free objection control on the Privacy and Cookie Policy pages; disabling it clears pending native rows and prevents further collection. This was introduced as a proposed PECR safeguard, not an agreed product decision. If it is not approved, the default-on native signed-out outbox must not be released under the statistical-purposes exception without a different lawful design.

## Personalisation offline decision

The native app caches only server-ranked personalised pages, keyed by account and server cursor, in the encrypted private database. A successful online consent check is cached for 12 hours. This allows previously downloaded pages to be read offline without creating a second ranking algorithm or copying the derived interest profile into local storage. It does not calculate new personalised rankings offline. A fresh offline Account-page load can read the encrypted cached consent state; if it is missing or stale, the user can write a local deny tombstone and delete cached personalised pages before server synchronisation.

Do not persist a derived religious-interest profile in the public catalogue database. Do not treat a stale cached consent flag as current consent after an offline account switch or withdrawal on another device. For this Android/Electron release, personalised feed pages are stored only in the encrypted private database, scoped to the account, with a 12-hour consent freshness limit and deletion on local withdrawal/account switch. iOS is out of scope for this release.

Offline personalisation is limited to previously downloaded pages while the local consent check remains fresh. A model-version change deletes old personalised pages before they can be reused; the app must download a newly ranked page online before personalised offline continuation resumes. After 12 hours, on withdrawal, account change, or when the next page was not downloaded, the app falls back to the cached server-ranked general feed, then a shuffled local catalogue page.

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


## Implementation and release status

The PR now contains:
- Durable anonymous topic/comment analytics outbox in app-private catalogue SQLite.
- Durable signed-in topic/comment/sponsor analytics outbox in the encrypted private activity database on Android and Electron.
- Server-ranked general-feed page caching and encrypted, consent-bound caching of previously downloaded personalised pages.
- Updated privacy and Cookie Policy disclosures, PECR assessment notes, regression tests and 2.4.0 release notes.
- Root, Electron and Android version metadata aligned to 2.4.0. The Android release workflow derives a monotonic version code from the semantic version.

The release is not yet verified. Exact-head CI, Android/Electron force-close/reconnect testing, offline page-cache acceptance, and controller PECR sign-off remain required.

## Important sync distinction

The signed-in *activity* outbox for likes, bookmarks and completion remains the revision-aware, account-linked synchronisation system. The signed-in *analytics* outbox for topic, Top Comments and sponsor events is a separate encrypted, account-scoped queue on Android and Electron. It has a 2,000-event per-stream cap, seven-day expiry, server-acknowledgement deletion and sign-out/account-switch cleanup. It does not use activity revisions or cross-device reconciliation. The website retains bounded in-memory analytics queues. Signed-out analytics remain separate and contain no account, visitor or session identifiers. Sponsor analytics remain separate from both analytics outboxes.
