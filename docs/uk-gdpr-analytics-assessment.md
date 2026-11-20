# CathoScroll UK GDPR analytics assessment (controller draft)

**Assessment date:** 20 November 2026  
**Scope:** First-party topic-feed, Top Comments, sponsor delivery/performance, signed-out aggregate analytics, Vercel Web Analytics and Speed Insights. Recommendation personalisation is considered only to confirm separation; its consent flow remains on signup and Account settings.  
**Status:** Engineering assessment and proposed control design. **Not controller approval, legal advice, or a completed/signed DPIA.**

**Current consent model:** enabling recommendation personalisation also enables Service improvement analytics, which cannot be disabled until personalisation is withdrawn. The recommendation profile uses only activity recorded after that explicit opt-in. The two purposes are disclosed together for the period personalisation is enabled; Sponsor measurement remains separate.

## 1. Executive conclusion

CathoScroll can retain most of its existing analytics. The proportionate approach is to separate the purposes and collection levels rather than switch all measurement off:

1. Keep essential operational/security records that are genuinely necessary to run, secure and synchronise the service, subject to their own documented purpose and retention.
2. Ask for a separate, optional, affirmative **Service improvement analytics** choice before collecting account-linked topic and comment activity. The notice must expressly explain that, in a Catholic-content service, topic interactions may reveal or permit inferences about religious or philosophical beliefs. Use a separate explicit statement/checkbox for this stream, not the personalisation checkbox.
3. Keep the signed-out topic/comment aggregate pipeline separate. It records daily entity-level counts without account, visitor or session identifiers and does not calculate anonymous unique people. Its surrounding request metadata, small-cell disclosure risk and native SQLite outbox still require a documented PECR/UK GDPR assessment; do not describe it as automatically anonymous or PECR-exempt.
4. Keep sponsor delivery operational, but separate sponsor measurement from delivery. If a visitor does not opt in to sponsor measurement, retain only a server-side campaign/day served-placement aggregate needed to reconcile delivery. Do not create client viewability/click events, session tokens, visitor frequency records or per-person frequency profiles for that visitor. Global campaign pacing and campaign-wide caps continue to protect inventory. Detailed viewability, clicks, CTR and per-session frequency controls are available only where the visitor has made the separate sponsor-measurement choice.
5. Gate Vercel Web Analytics and Speed Insights behind the service-improvement analytics choice. Keep URL redaction. Do not assume Vercel's short-lived request hash is anonymous or automatically covered by the PECR statistical-purposes exception.
6. Keep recommendation personalisation separate and unchanged in purpose. Its signup and Account controls remain the only place to opt in/out; it must not be silently enabled by the analytics popup.

Declining optional analytics must not sign a person out, disable account access, stop bookmarks/likes/progress/notes synchronisation, alter general server ranking, or disable ordinary feed delivery. Those functions are not analytics consent.

## 2. Processing map and risk assessment

| Stream | Current data/operation | Main privacy issue | Proposed lawful/control position |
|---|---|---|---|
| Signed-in topic feed | Account-linked event IDs, session IDs, topic IDs, event type and bounded metrics; raw events and viewer bridge up to 180 days; aggregate admin reporting | Topic activity in a Catholic service can reveal or permit inference about religious/philosophical beliefs. Account linkage makes it personal data; a restricted dashboard does not make collection anonymous. | Opt-in service analytics with a clear explicit statement about the sensitive nature of topic activity. Proposed Article 6(1)(a) and, where the data reveals special-category beliefs, Article 9(2)(a). Retain only the existing bounded event detail needed for agreed reporting, then aggregate and delete on schedule. |
| Signed-in Top Comments | Account-linked comment-card IDs, session IDs and impression/viewability/duration/skip/open events | Comment exposure can reveal interests and may be sensitive in context. | Same separate service-analytics choice; never use for recommendation ranking unless personalisation is independently enabled. |
| Signed-in sponsor delivery/performance | Account-linked served/viewable/click events and per-user frequency controls; admin/sponsor reporting is aggregate | Advertising measurement and frequency control are distinct from core service analytics; account-linked exposure is personal data and may reveal interests. | Separate sponsor-measurement opt-in. Without it, no account-linked client event or per-user frequency record. Continue the campaign/day served aggregate only. Sponsor users continue to receive aggregate reporting only. |
| Signed-out topic/comment | Event UUID, public entity ID and bounded metrics; daily aggregate tables; no persistent visitor/session/account identifier; native seven-day app-private outbox; 30-day dedupe receipts | Daily topic/comment cells and request metadata can still be identifying in context. Native outbox is terminal-equipment storage even though app-private. | Preserve as a distinct anonymous/aggregate stream only after the controller documents the PECR Regulation 6 route, notice and free objection. Do not claim unique people/sessions. Apply minimum-cell/suppression review where low counts could reveal activity. |
| Signed-out sponsor | Current in-memory random session token; server stores token hash for frequency controls; separate daily campaign aggregates; raw event/frequency rows currently 30 days | Hashed session token remains pseudonymous tracking, not anonymous data. Per-session frequency and client view/click events are advertising measurement. | With sponsor-measurement choice off, no token/hash, per-session frequency, client viewability or click tracking. Record only server-side campaign/day served totals without visitor/session keys. With choice on, retain the existing richer event/frequency measurement with the disclosed short retention. |
| Vercel Web Analytics | Request-derived visitor hash discarded after 24 hours; URL/referrer/device/route and other metadata used for reporting | Short-lived hash still distinguishes a visitor during its life; request metadata may be personal data. Provider role/contract and international transfer also matter. | Load only after service-analytics opt-in. Continue path/query redaction and review provider logs/retention/contract. |
| Vercel Speed Insights | Core Web Vitals plus route/browser/device/network metadata | Lower identification capability than session analytics, but still client-side collection and provider processing. | Load only after service-analytics opt-in for a consistent user choice. Continue route/query redaction. |
| Recommendation personalisation | Private account-history signals and derived category/topic interests; may reveal beliefs; encrypted native cache | This is profiling and potentially special-category processing, distinct from operational measurement. | Keep the existing separate explicit opt-in on signup and Account settings. Do not include it in the analytics popup. Keep current offline cache/consent freshness and withdrawal behaviour. |

## 3. Article 6 and Article 9 assessment

### 3.1 Account-linked topic and comment analytics

The existing purpose is internal service measurement: understanding whether content is reached, read, completed, skipped or discussed; improving reliability and the service; and operating administrator reporting. The current implementation says these events are not used to create belief labels/profiles, make individual decisions, or target sponsors.

That purpose is legitimate in principle, but it does not settle necessity or balancing. Account-linked event history is more intrusive than aggregate counts, particularly where the service's subject matter is religious. The current 180-day raw retention and user/day viewer bridge also mean this is not merely anonymous counting.

**Recommended controller position:** do not rely on a generic legitimate-interests statement as the sole answer for account-linked topic/comment telemetry. Use a dedicated optional service-analytics consent. Because the context may reveal religious/philosophical beliefs, the choice should expressly identify that nature of the data and be a clear, separate affirmative statement capable of meeting Article 9(2)(a) explicit-consent requirements where applicable. Use Article 6(1)(a) for this optional stream. Consent must be freely given, specific, informed, recorded, and as easy to withdraw as to give. Account access and core sync must remain available if declined.

This is a conservative risk-control recommendation, not a legal finding that every individual topic impression necessarily constitutes special-category data. The controller must confirm whether the data, purpose and actual use meet the statutory “revealing” test. If the controller concludes that Article 9 is not engaged for a defined aggregate-only operation, it must document why and still select an Article 6 basis for any personal data involved.

### 3.2 Sponsor measurement

Sponsor delivery and sponsor measurement are different purposes. Delivering a paid campaign can be necessary to fulfil the sponsor agreement and to enforce global campaign caps. Measuring an individual's viewability, click behaviour or frequency is not automatically necessary to deliver the placement.

**Recommended controller position:** offer sponsor measurement as a separate optional choice. Do not bundle it into service analytics. If declined, retain server-side campaign/day served-placement totals only; do not collect a user-linked or session-linked view/click/frequency record. The current anonymous event attribution includes the topic placement identifier where the sponsor appeared. In a Catholic-content service, that context may reveal or permit inference about religious/philosophical beliefs; where it meets the Article 9 revealing test, treat the event as special-category processing and require explicit consent under Article 9(2)(a) alongside Article 6(1)(a). The Sponsor measurement wording must disclose the account linkage, hashed signed-out session and topic-placement context. If the controller does not approve that basis, remove topic-level attribution from sponsor measurement before enabling it. The controller should separately document the Article 6 basis for server-side delivery accounting and security/abuse prevention. Do not give sponsors user identities, device/session identifiers, individual histories or personalisation data.

A served count is not a unique-person count. Do not describe it as reach or unique impressions.

### 3.3 Signed-out aggregate service statistics

The current signed-out topic/comment pipeline is materially less intrusive than account-linked telemetry: no persistent visitor ID, session ID or account ID; no unique-person count; and the server stores daily aggregates. The native retry queue is still local terminal-equipment storage and must be assessed under PECR Regulation 6.

The ICO statistical-purposes exception may be available only if every statutory condition is met, including exclusive service-improvement statistics, aggregate non-personal output, no tracking/monitoring or decisions about individuals/groups, prompt deletion of individual inputs once aggregation is complete, clear notice and a simple/free objection route. It cannot be used as a shortcut for advertising measurement. The controller should approve this route explicitly and verify deployed behaviour. If the conditions are not met, obtain the required consent or stop the affected terminal storage/access.

## 4. Consent and preference design

The proposed first-visit centred modal should be styled with CathoScroll's existing Card, typography, neutral background and purple accent. It must not obscure the app after a choice has been made and must be reopenable from the Cookie/Privacy settings.

Optional choices start off for new visitors. Provide equally clear **Accept all**, **Reject optional**, and **Save choices** actions, with individual controls:

- **Service improvement analytics (optional):** first-party topic and Top Comments engagement measurement, including account-linked activity when signed in, anonymous aggregate topic/comment statistics, and Vercel Web Analytics/Speed Insights. The explanation must say that topic activity on a Catholic-content service may reveal or permit inferences about religious/philosophical beliefs. This choice is separate from personalisation.
- **Sponsor measurement (optional):** client-side sponsor viewability, clicks, CTR and per-session/per-account frequency measurement. Anonymous attribution includes the topic placement where the sponsor appeared; where that context reveals religious/philosophical beliefs, explicit consent under Article 9(2)(a) is required alongside Article 6(1)(a). The consent wording discloses this. If off, retain only server-side campaign/day served totals without visitor/session tracking.
- **Essential operation (always on):** authentication, account security, requested account/data synchronisation, consent preference storage, abuse prevention and other genuinely necessary operations. Do not place optional analytics inside this category.

Do not pre-tick optional controls, treat inactivity as agreement, make Reject harder to use, or make service access conditional on analytics consent. Store a versioned record of each affirmative choice and withdrawal. The preference mechanism itself may store the minimum state needed to remember the user's decision; document that strictly necessary purpose and use no advertising identifier for it.

For signed-in analytics, an affirmative choice should be auditable against the account. For signed-out preferences, use a first-party preference record without creating a cross-site or cross-device visitor identity. Native preference persistence must be reviewed separately from browser storage.

## 5. Withdrawal and queue handling

When service analytics is disabled:
- Stop creating new signed-in topic/comment analytics events immediately.
- Clear unsent in-memory and native encrypted outbox events for the account; do not upload pre-withdrawal events later after a re-consent.
- Stop Vercel Analytics and Speed Insights collection.
- Preserve account login, bookmarks, likes, progress, notes, offline catalogue and general ranked feed.
- Keep recommendation personalisation state independent; it remains controlled only by signup/Account consent.

When sponsor measurement is disabled:
- Stop creating signed-in and signed-out client viewability/click/frequency events immediately.
- Clear unsent sponsor measurement events and any visitor/session frequency token/hash attributable to that preference, subject to database deletion design.
- Continue sponsor delivery and global campaign pacing/caps.
- For this visitor, record only server-side campaign/day served-placement aggregates. Do not claim viewability, clicks, CTR, unique reach or per-person frequency for opted-out delivery.

When signed-out aggregate topic/comment measurement is disabled through its separate objection/preference control:
- Stop new anonymous event creation.
- Clear pending web/native retry events and ensure re-enabling does not upload stale pre-withdrawal events.
- Preserve all core content and account functionality.

## 6. Necessity, proportionality and minimisation

The following controls are proportionate and preserve the useful analytics:
- Keep the current event taxonomy and dashboard breakdowns for people who opt in.
- Keep separate signed-in and signed-out totals; do not merge them into misleading unique-user metrics.
- Retain raw account-linked analytics for no longer than the documented 180-day operational window only while the relevant consent is active; aggregate and delete detail under the existing bounded jobs.
- Keep signed-out topic/comment aggregates free of visitor/session/account IDs and suppress small cells where a low count could expose an individual's activity.
- For sponsor measurement opt-outs, retain campaign/day served counts only. Keep richer viewability/click/CTR and frequency metrics for opt-in visitors.
- Keep sponsor reports aggregate-only and prevent sponsor access to raw event tables.
- Continue event validation, rate limits, server-authoritative timestamps, idempotency, private tables, RLS and bounded cleanup.
- Do not repurpose analytics for recommendation profiling, religious-affiliation inference, individual decisions or sponsor targeting.

## 7. DPIA screening and risk register

A DPIA is appropriate and should be completed before the new consent-gated account analytics is broadly enabled. The combination of religious-content context, account-linked behavioural records, recommendation profiling (separately consented), native offline persistence, sponsor measurement and children potentially using the service creates enough sensitivity to justify a full documented DPIA even if the controller ultimately concludes that some operations are not legally “high risk”.

| Risk | Inherent level | Required mitigation | Residual assessment |
|---|---|---|---|
| Topic/comment activity reveals beliefs | High | Separate explicit service-analytics choice; no collection if declined; purpose limitation; 180-day maximum; aggregate reporting; strict access controls | Medium; controller to approve |
| Sponsor event data becomes behavioural advertising profile | High | Separate sponsor choice; no user-level sponsor targeting; opt-out path records only campaign/day served aggregate; no raw sponsor events to sponsors | Low/Medium; verify actual SQL and APIs |
| Small signed-out topic/day cells expose an individual's activity | Medium | No persistent IDs; minimum-cell/suppression threshold; short-lived dedupe receipts; minimise request logs | Low/Medium; controller to set threshold |
| Native queue storage falls outside expected PECR route | Medium/High | Document Regulation 6 analysis, preference and deletion behaviour; verify Android/Electron deployed storage | Medium until PECR sign-off |
| Consent state fails to propagate across web/native transports | High | Central consent service; immediate event gates; queue clearing; automated tests for each stream/platform | Low after tests and deployment verification |
| Re-consent uploads old events collected before withdrawal | Medium | Clear queues on withdrawal and before enabling; version/timestamp checks | Low after tests |
| Vercel processes routes/metadata before consent | Medium | Do not mount SDK components until opt-in; keep URL redaction; review logs, DPA, transfers | Medium until provider contract review |
| Children or vulnerable users cannot give valid consent | High | Confirm age policy, capacity and parental/child design; do not infer consent from account creation | Open controller decision |
| Data breach exposes account-linked topic history | High | Private schema, no client grants, least privilege, encryption at rest, access audit, bounded retention and incident response | Medium; verify production controls |

## 8. Controller decisions required

The controller must complete and sign off these decisions; engineering cannot make them on the controller's behalf:

1. Confirm the controller's legal identity, address and contact route, and confirm who is responsible for data-protection requests.
2. Approve Article 6(1)(a) and Article 9(2)(a) as the basis/condition for optional account-linked service analytics where the content/activity reveals special-category beliefs, or document a different valid Article 6/Article 9 combination before collection.
3. Confirm whether signed-out topic/comment aggregates meet every condition of the PECR statistical-purposes exception; if not, use prior consent or disable the relevant storage/access.
4. Approve the separate sponsor-measurement purpose and Article 6 basis; confirm that opt-out campaign/day served totals are sufficient for non-consenting visitors.
5. Confirm whether under-18 users may use analytics/personalisation and what age-appropriate consent and safeguards are required.
6. Approve the residual DPIA risks and retention periods, including sponsor accounting records and request/security logs.
7. Confirm processor/controller roles, DPAs, subprocessors and international transfer safeguards for Supabase and Vercel. No paid sponsor campaigns are currently active; the owner intends to move to an appropriate commercial hosting plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service.
8. Confirm PECR treatment of browser consent-preference storage and native app preference/outbox storage, and approve the deployed implementation after web and physical Android/Electron verification.

## 9. Legal and technical sources

- ICO, [Special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/) (updated October 2026): Article 6 basis and separate Article 9 condition are both required; inferred religious/philosophical beliefs may be special-category data.
- ICO, [What are the conditions for processing?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/): explicit consent must be specific, affirmative, clear, identify the nature of the special-category data and be withdrawable.
- ICO, [Data protection impact assessments](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/): DPIA screening and high-risk processing criteria.
- ICO, [Lawfulness, fairness and transparency](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/lawfulness-fairness-and-transparency/): purpose-specific lawful basis and transparent processing.
- Existing implementation record: `docs/feed-analytics-implementation.md`, `docs/analytics-data-protection-impact-assessment.md`, `docs/provider-and-pecr-review.md`, `docs/privacy-and-legal-implementation.md`.

## 10. Approval record

**Controller:** Not yet named/confirmed in this engineering record.  
**Article 6 basis approval:** Pending.  
**Article 9 condition approval:** Pending where applicable.  
**PECR Regulation 6 assessment:** Pending controller sign-off.  
**DPIA residual-risk approval:** Pending.  
**Date approved:** Pending.

No code change, checkbox or this draft assessment should be represented as a guarantee of legal compliance until the controller has completed the decisions above and verified the deployed behaviour.

## Implementation status: consolidated PR #25

The consent controls were merged in PR #25 and deployed to production in commit `e0da259` on 20 November 2026. The three database migrations are recorded as applied in production. Browser/native end-to-end verification and controller approval remain separate outstanding checks:

- Separate default-off Service improvement analytics and Sponsor measurement choices, with Accept all, Decline optional and Manage choices.
- Explicit service-improvement wording describing the risk that signed-in topic/comment engagement may reveal religious or philosophical beliefs.
- Account-scoped signed-in consent storage/history and server-side gates for signed-in topic, comment and sponsor measurement events.
- Device-local signed-out consent kept separate from account consent; signed-out aggregate events continue to omit account/session/visitor identifiers.
- Immediate local withdrawal, purpose-specific offline queue clearing, and retryable signed-in consent synchronisation.
- Sponsor delivery continues after measurement refusal, with campaign/day served totals only and no visitor/session frequency or viewability/click records.
- Vercel Web Analytics and Speed Insights are gated behind Service improvement analytics. Recommendation personalisation remains separate.

The initial consent migration was executed in a transaction against the existing production schema and rolled back before permanent application; consent and sponsor-selector smoke tests were also run in a separate rolled-back transaction. The three migrations are now recorded in production, and the live database has the consent tables and null-session sponsor selector behaviour. No separately billed disposable Supabase branch was created, so a separate clean-install PostgreSQL test remains outstanding. The matching app code is not active in production until PR #25 is merged and deployed. Do not rely on this draft as evidence of legal compliance; controller approvals and deployed-behaviour verification remain outstanding.

Before release, the controller must approve the Article 6 basis for each analytics purpose and determine whether account-linked topic/comment activity is special-category data in the actual processing. If it is, the controller must document and validate the Article 9 condition; explicit consent must be specific, informed, freely given, unambiguous and withdrawable. The consent interface is a technical control, not legal approval.
