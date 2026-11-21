# CathoScroll analytics data protection impact assessment

**Working DPIA — controller approval required**

This is not a legal opinion.

This assessment covers signed-in Service improvement analytics, signed-in Sponsor measurement, Personalisation, general feed ranking, Vercel Web Analytics/Speed Insights and the supporting web/native queues. It does not cover anonymous analytics because the final product decision is to collect none.

## 1. Processing purpose

Service improvement analytics measures signed-in topic-feed and Top Comments engagement after explicit opt-in. Sponsor measurement separately measures signed-in sponsor viewability, clicks and frequency after explicit opt-in. Personalisation creates a private account-level recommendation profile after explicit opt-in. General feed ranking uses public interaction signals, curated content order and exposure balancing; it does not use anonymous analytics or sponsor events.

Sponsor delivery remains available without measurement. Sponsor selection/display does not create a delivery counter or analytics record.

## 2. Data and people

The relevant data may include account identifiers, topic/comment identifiers, event/session identifiers, event type, bounded durations and server receipt timestamps. Sponsor events contain campaign/event/session identifiers, a server-issued placement receipt and event type. The receipt is created only for opted-in accounts, stored in the encrypted native outbox when pending, and expires server-side after seven days. Recommendation profiles contain selected category interests and derived topic/category scores.

Users of a Catholic theology service may disclose or permit inference of religious or philosophical beliefs through their reading activity. Treat account-linked reading signals and derived recommendation profiles as potentially special-category data where the processing intentionally reveals, infers or uses those beliefs.

## 3. Necessity and proportionality

Only collect events needed for the opted-in purpose. Keep Service improvement and Sponsor measurement separate. Do not add sponsor topic/category identifiers or use reading history for sponsor targeting. Sponsors receive aggregate reporting for the consented population only, not raw user-level records or total-platform delivery estimates.

No anonymous topic/comment analytics, sponsor engagement, served totals, campaign/day delivery counters, anonymous identifiers, anonymous retry queues or anonymous analytics tables are collected. Sponsor placements remain visible without measurement.

## 4. Lawful basis and consent

The controller must document an Article 6 basis for each purpose and a separate Article 9 condition wherever special-category beliefs are processed. Explicit consent may be appropriate under Article 9(2)(a), provided it is specific, informed, freely given, affirmative, recorded and withdrawable. Consent must be purpose-specific and not bundled with access to the service.

Personalisation and Service improvement analytics are implemented as independent choices. Personalisation covers direct account actions and selected categories. Passive reading signals are collected only under Service improvement consent and inform recommendations only when Personalisation is also enabled. Withdrawing Service improvement invalidates the recommendation profile so passive reading signals are removed while direct-action personalisation remains.

## 5. PECR and terminal storage/access

The removal of anonymous analytics avoids relying on a statistical-purposes exception for those pipelines. It does not settle PECR for signed-in analytics. Review actual browser and native storage/access behaviour, including Vercel SDKs, WebViews, SQLite, local storage and any other terminal storage/access. Obtain prior consent wherever required and ensure withdrawal stops further access. Do not assume account linkage, first-party processing or memory-only retry makes PECR irrelevant.

Sponsor measurement is advertising measurement and must not start before the separate Sponsor measurement choice is enabled.

## 6. Security and retention

Signed-in raw analytics, the restricted viewer bridge and associated event-rate-limit records are retained for up to 180 days under the current implementation. Native pending signed-in events use encrypted app-private storage, a 2,000-event per-stream cap and seven-day expiry; acknowledged events and withdrawn streams are cleared. Website pending queues are memory-only. Apply least-privilege access, service-role-only database functions, event validation, rate limits and audit logging.

Withdrawal must immediately deny new local collection, clear the matching queue, stop uploads and synchronise the denial server-side when online. Personalisation withdrawal must stop new profile updates and delete the derived profile and selected interests.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reading analytics reveals religious/philosophical beliefs | Explicit, purpose-specific consent; minimise fields; restrict access; short raw-event retention |
| Sponsor events become a religious-interest advertising profile | Separate Sponsor measurement; no topic/category IDs; no sponsor targeting from reading history; aggregate reports only |
| Optional analytics continues after withdrawal | Immediate local denial, queue clearing, abort active flushes and server synchronisation |
| Native outbox survives account or consent changes | Encrypted account-scoped streams; clear on withdrawal/account change; acknowledgement deletion; seven-day expiry |
| Provider SDK accesses terminal storage before consent | Gate SDK loading; inspect deployed network/storage behaviour; document PECR position |
| Sponsor reporting overstates performance | Report only opted-in measured events; do not extrapolate to total deliveries or reach |
| Anonymous analytics is reintroduced accidentally | Regression tests, code review and schema checks prohibit anonymous queues, endpoints, tables and delivery counters |

## 8. Residual risk and controller actions

The subject matter and account-linked profiling create a material risk of special-category inference. A proportionate DPIA is prudent. Whether a full DPIA is legally mandatory depends on the scale and whether the processing is likely to result in high risk; assess this formally rather than assuming the small current user base settles the question.

Before release, the controller must approve the Article 6/9 position, verify the independent Personalisation/Service improvement consent flows, inspect PECR storage/access, verify provider processor terms and international transfer safeguards, confirm ICO fee-registration status, maintain a record of processing activities and obtain specialist legal review.


### Withdrawal safeguards

The consent RPC removes account-linked raw event records and viewer bridges for a withdrawn purpose, deletes sponsor placement receipts where relevant, and rebuilds recent aggregate tables without the withdrawn account's events. The Personalisation profile is refreshed without passive reading signals when Service improvement is withdrawn. Local website/native pending queues are cleared. Historical aggregates beyond the raw-event retention window may remain only as non-identifying totals.
