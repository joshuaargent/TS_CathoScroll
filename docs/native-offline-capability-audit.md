# Native offline capability and analytics audit

## Offline capability

| Capability | Android / Electron behaviour | Offline behaviour |
|---|---|---|
| Feed and topic pages | Shared web pages and server-ranked topic payloads | The latest downloaded server-ranked pages are cached in encrypted local storage for offline reading |
| Personalisation | Server-derived private category/topic ordering | Cached server-ranked pages only; no separate offline learner |
| Likes, bookmarks and progress | Account-scoped activity sync | Existing revision-aware activity outbox queues changes and syncs on reconnect |
| Signed-in Service improvement analytics | Encrypted account-scoped SQLite outbox | Only events created while explicit consent is active are queued; max 2,000 per stream, seven-day expiry, acknowledgement deletion |
| Signed-in Sponsor measurement | Separate encrypted account-scoped SQLite stream | Only opted-in viewability/click events are queued; max 2,000 per stream, seven-day expiry, acknowledgement deletion |
| Anonymous analytics | Not implemented | No anonymous event creation, queue, storage or upload |
| Sponsor delivery without measurement | Campaign selection through the shared API | Sponsor cards remain available; no served counter, session token, event or frequency record is created |

## Consent and queue lifecycle

Analytics outboxes are distinct from the account activity-sync outbox. They must not block bookmarks, likes, progress, notes, comments or other user-facing actions.

On consent withdrawal:
- Deny new local collection immediately.
- Abort active uploads and clear the matching pending stream.
- Persist the signed-in denial locally so it remains effective offline.
- Synchronise the denial to the server when connectivity returns.
- Clear the prior account's queues on account change or sign-out.

The native analytics outbox is encrypted and account-scoped. It is not a generic telemetry store. No anonymous native queue or anonymous local preference exists.

## Offline personalisation

Native clients use previously downloaded server-ranked pages from encrypted storage, subject to the existing cache expiry and consent-freshness rules. They do not learn a recommendation profile locally while offline. When the cached consent state is stale or withdrawal is pending, personalisation is denied until the server state is refreshed.

## Release checks

- Confirm no import or configuration of an anonymous analytics client or SQLite store.
- Confirm only opted-in signed-in analytics streams can enter the native outbox.
- Confirm withdrawal and account-switch cleanup work while offline and synchronise when online.
- Confirm unmeasured sponsor delivery does not write counters or queue events.
- Confirm native UI remains usable when analytics storage or upload is unavailable.
