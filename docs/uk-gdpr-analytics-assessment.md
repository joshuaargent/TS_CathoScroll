# UK GDPR and PECR analytics assessment

**Controller working assessment — 21 November 2026**

This is not a legal opinion.

This document records the intended CathoScroll analytics model and the issues the controller must verify. It is not formal legal advice and must not be treated as completed solicitor sign-off.

## 1. Final product decision

CathoScroll does not collect anonymous analytics or sponsor delivery counters. This applies to signed-out visitors and signed-in users who have not opted into the relevant account-linked purpose.

No anonymous topic/comment totals, anonymous sponsor views/clicks/duration/frequency, served counters, campaign/day totals, visitor/session tokens, anonymous event receipts, anonymous retry queues or anonymous analytics database tables are to remain active.

Sponsor cards continue to be delivered when measurement is disabled. The act of selecting or displaying a sponsor is not recorded as an analytics event. There is no served count, anonymous reach estimate or delivery pacing counter.

The retained optional streams are:

- Signed-in Service improvement analytics, requiring explicit account opt-in.
- Signed-in Sponsor measurement, requiring a separate explicit account opt-in.
- Personalisation, requiring explicit account opt-in and used only for private recommendations.

Sponsor measurement is never used for organic ranking, Personalisation or individual belief-based targeting.

## 2. Data flows and purposes

### Service improvement analytics

When enabled, signed-in topic-feed and Top Comments events are linked to the account and include defined content identifiers, event identifiers, session identifiers, event types and bounded measurements. The purpose is to understand engagement and improve CathoScroll. The subject matter may reveal or permit inference of religious or philosophical beliefs.

### Sponsor measurement

When enabled, signed-in sponsor viewability, click and frequency events are account-linked. Event payloads are limited to campaign/event/session identifiers, the server-issued placement receipt and event type. The receipt proves that the campaign was selected for this opted-in account and expires after seven days. Do not add topic IDs, category IDs, reading histories or recommendation profile fields. Sponsor reports are aggregated and restricted to the consented population; they must not be presented as total platform delivery or total audience reach.

### Personalisation

Personalisation maintains a private account-level recommendation profile from eligible post-consent activity and selected category interests. It must not be used for sponsor targeting. Turning it off stops new recommendation processing and deletes the derived profile and selected interests under the implementation's deletion procedure.

Personalisation and Service improvement analytics now have independent explicit choices. Personalisation uses direct account actions and selected categories. Passive reading signals are collected only under Service improvement consent and inform recommendations only when Personalisation is separately enabled as well. Withdrawing Service improvement removes passive reading signals from the recommendation profile while leaving direct-action personalisation available; withdrawing Personalisation deletes the derived profile.

## 3. Lawful basis and special-category data

For each purpose, document the Article 6 basis. Where reading behaviour or profiles intentionally reveal, infer or use religious/philosophical beliefs, identify a separate Article 9 condition. Article 6 consent alone is not an Article 9 condition.

Explicit consent under Article 9(2)(a) may be suitable for Personalisation and any analytics purpose that processes special-category belief data. It must be specific, informed, freely given, affirmative, recorded and as easy to withdraw as to give. Consent wording must identify the relevant reading/activity data and the recommendation or analytics purpose.

Do not use legitimate interests to bypass Article 9 or PECR. For operational processing that does not involve special-category data or terminal storage/access, legitimate interests may be considered only after a documented necessity and balancing assessment.

## 4. PECR

The anonymous pipelines have been removed rather than relying on the statistical-purposes exception. Sponsor measurement is advertising measurement and is gated behind prior explicit opt-in.

The controller must still inspect actual web and native behaviour for storage/access technologies. Check Vercel Web Analytics, Speed Insights, application code, embedded WebViews, local databases and any SDKs. Do not assume that memory-only queues, account linkage, first-party processing or short retention automatically avoids PECR. Any optional storage/access must be covered by valid prior consent where required, with withdrawal stopping future access.

## 5. Sponsor targeting and reporting

Sponsor eligibility may use campaign configuration and the current page context to decide which campaign to show. Do not persist a person's religious-content interests for sponsor targeting or link sponsor campaigns to their recommendation profile.

Sponsor measurement reports must include only account-linked events from users who enabled Sponsor measurement. Do not extrapolate these results to all deliveries, total reach or all CathoScroll users. No campaign served totals or anonymous delivery counts are collected.

## 6. Retention and technical controls

- Signed-in raw feed/community/sponsor event records and the restricted viewer bridge: up to 180 days under the current implementation.
- Native pending signed-in analytics: encrypted app-private storage, maximum 2,000 events per stream, seven-day expiry, acknowledgement deletion and account/consent cleanup.
- Website pending signed-in analytics: memory-only retry queues.
- Derived Personalisation profile: delete on Personalisation withdrawal; retain no longer than required for the active recommendation purpose.
- Consent records/history: retain only as needed to demonstrate and administer the user's choices, subject to account deletion and legal requirements.
- Anonymous analytics and sponsor delivery counters: not collected; legacy anonymous tables, functions, cron jobs and queues must be removed by the database upgrade.

Withdrawal must stop new collection locally immediately, clear pending events for the withdrawn stream, prevent subsequent uploads, and synchronise the denial to the server when connectivity returns. Do not silently switch lawful basis for the same optional purpose after withdrawal.

## 7. DPIA, records and provider due diligence

Complete a DPIA screening and a proportionate DPIA. A full DPIA is mandatory if the processing is likely to result in high risk; assess the scale of special-category data, systematic profiling, vulnerable users, data linkage and likely effects. Keep a record of processing activities, purpose-specific retention, access controls, processor instructions, consent evidence and data-subject request procedures.

Verify current Article 28 processor terms, subprocessors, processing locations, international transfer safeguards, security logs and retention for Vercel, Supabase and every other provider. Update the privacy notice with controller identity, purposes, Article 6 bases, Article 9 conditions, recipients, transfers, retention, rights and complaint route. Complete the ICO fee self-assessment and confirm registration status. As a sole trader, the controller may fall into Tier 1 (£52 annually where turnover is no more than £632,000 or staff numbers no more than 10), unless a specific exemption applies. Do not assume exemption; consider the public-register address before registering.

## 8. Release checklist

- Confirm all anonymous analytics clients, APIs, controls, native queues, SQL tables/functions, cron jobs and admin/sponsor reporting paths are removed.
- Confirm sponsor delivery creates no served counter, event receipt, session token, frequency record or aggregate delivery row when measurement is off.
- Confirm opted-in signed-in Sponsor measurement still records only viewable impressions and clicks, with frequency derived from those consented viewability events.
- Confirm signed-in Service improvement analytics and Personalisation remain properly gated and withdrawal-safe on web, Android and Electron.
- Confirm no sponsor targeting or organic ranking uses religious-interest profiles or sponsor activity.
- Run full tests, type-check, lint, production build and Android/Electron builds; obtain fresh independent code review.
- Obtain controller and solicitor sign-off before applying production SQL or deploying.


## Withdrawal behaviour

A withdrawal stops collection immediately, clears the relevant local queue, deletes the account's raw event records and receipts for that purpose, and rebuilds recent aggregate reporting without those records. Service improvement withdrawal also removes the user's viewer-bridge rows and refreshes any private recommendation profile without passive reading signals. Sponsor measurement withdrawal removes account-linked sponsor events and placement receipts and rebuilds recent campaign aggregates from the remaining opted-in event ledger. Older aggregate totals may remain only where they no longer identify or link to an individual.
