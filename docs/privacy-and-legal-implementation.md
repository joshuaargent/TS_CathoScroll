# Privacy and legal implementation

**Controller working implementation record — legal approval required**

## Final collection model

CathoScroll collects no anonymous engagement analytics and no sponsor delivery counters. This includes signed-out visitors and signed-in users who have not enabled the relevant optional purpose.

No anonymous topic/comment impressions, viewability, duration, skips, completions or opens are collected. No anonymous sponsor views, clicks, duration, frequency, served totals, campaign/day totals, visitor/session identifiers, retry queues, event receipts, database aggregates or native SQLite outboxes are retained.

Sponsor placements remain available when measurement is off. Delivery selection and display create no analytics record.

## Optional signed-in purposes

- **Service improvement analytics:** account-linked topic and Top Comments engagement, only after explicit opt-in.
- **Sponsor measurement:** account-linked sponsor viewability, clicks and frequency, only after a separate explicit opt-in.
- **Personalisation:** a private recommendation profile, only after explicit opt-in. It must not be used for sponsor targeting.

The Catholic theology context means reading signals may reveal or permit inference of religious/philosophical beliefs. Where processing intentionally reveals, infers or uses those beliefs, document both the Article 6 lawful basis and Article 9 condition. Explicit consent under Article 9(2)(a) may be suitable if it is specific, informed, freely given, affirmative, recorded and easy to withdraw.

## Consent and withdrawal

Consent choices must be separate by purpose, presented in clear language, off by default and separate from terms of service. Withdrawal must be as easy as giving consent. It must immediately block new local collection, clear the matching pending web/native queue, abort active uploads and synchronise the denial to the server when connectivity returns.

Personalisation and Service improvement analytics are independent choices. Personalisation covers direct account actions and selected categories used for recommendations. Passive reading signals are processed only under the separate Service improvement choice and inform recommendations only when Personalisation is also enabled. Withdrawing either choice stops its corresponding processing.

## PECR

The anonymous statistical pipelines have been removed rather than relying on a statistical-purposes exception. This does not settle PECR for signed-in analytics. Inspect the actual browser and native storage/access behaviour of all analytics SDKs, WebViews, SQLite stores and identifiers. Obtain prior consent where required. Do not assume first-party, account-linked, memory-only or short-lived processing is exempt.

Sponsor viewability, clicks and frequency are advertising measurement and are gated behind prior Sponsor measurement consent. For opted-in accounts, a short-lived server-issued placement receipt validates that the campaign was selected; it expires after seven days and is deleted on withdrawal. No sponsor delivery count is collected for users who decline.

## Data minimisation and retention

Signed-in raw analytics events and the restricted viewer bridge are retained for up to 180 days. Separate HMAC-protected API rate-limit records contain endpoint/account-or-client keys, request counts and time-window timestamps; stale rows are opportunistically pruned after two days and are not engagement analytics. Native pending events are encrypted, account-scoped, capped at 2,000 per stream and seven days, deleted after acknowledgement and cleared on withdrawal/account change. Website queues are memory-only. Sponsor events contain no topic/category IDs or reading-history fields.

Keep recommendation profiles private and delete the derived profile and selected interests when Personalisation is withdrawn. Keep consent history only as long as needed to evidence and administer the choice, subject to account deletion and legal obligations.

## Required controller work

- Complete DPIA screening and a proportionate DPIA; complete a full DPIA if processing is likely to result in high risk.
- Maintain a record of processing activities, purpose-specific retention schedule, data-subject request process and consent evidence.
- Verify Vercel, Supabase and all other processor terms, subprocessors, processing locations, Article 28 terms and international transfer safeguards.
- Inspect production SDK requests, browser storage/access, native WebView behaviour and security logs.
- Document Article 6 and Article 9 bases for each purpose; complete a legitimate-interests assessment where that basis is relied upon.
- Complete the ICO fee self-assessment and confirm registration status. As a sole trader, the controller may fall into Tier 1 (£52 annually where turnover is no more than £632,000 or staff numbers no more than 10), unless a specific exemption applies. Do not assume exemption; consider the public-register address before registering.
- Update privacy information with controller identity, purposes, bases/conditions, data categories, recipients, transfers, retention, rights and complaint route.
- Obtain UK data-protection solicitor review and controller sign-off before release.

This document is not a legal opinion and does not certify provider contracts, transfers, ICO registration or deployed runtime behaviour.


## Consent withdrawal and data removal

Withdrawing Service improvement deletes the account-linked raw topic and Top Comments event records and user/day viewer bridges. The affected recent daily aggregates are rebuilt from the remaining opted-in event records, and the private recommendation profile is refreshed without passive reading signals. Withdrawing Sponsor measurement deletes that account's sponsor event records and placement receipts, then rebuilds recent campaign/day viewability and click aggregates from the remaining opted-in records. Local pending queues are cleared immediately. Aggregates older than the raw-event retention window may remain only as non-identifying totals with no user-level event or viewer bridge.
