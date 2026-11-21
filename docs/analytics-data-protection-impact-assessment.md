# CathoScroll analytics data protection impact assessment

**Assessment date:** 19 November 2026  
**Status:** Provisional internal assessment; not a legal opinion or a declaration of regulatory compliance.  
**Owner/controller:** CathoScroll's operator.  
**Review trigger:** Material changes to analytics purposes, data fields, vendors or retention, and at least annually.

## 1. Processing under review

This assessment covers first-party account-linked analytics for signed-in topic-feed and Top Comments activity; separate signed-out topic/comment daily aggregates; authenticated and anonymous sponsor delivery analytics; Vercel Web Analytics and Speed Insights; and recommendation personalisation as a separate purpose controlled by the account setting.

Signed-in topic/comment events remain account-linked. Signed-out topic/comment events are stored only as daily aggregates without account IDs, raw session IDs or persistent visitor IDs. Detailed Sponsor measurement is available only to signed-in users who explicitly opt in; its events are account-linked; per-placement IDs validate event attribution and account-level frequency records enforce caps. Signed-out visitors and signed-in users who decline receive only server-side campaign/day served aggregates, with no session token, frequency, viewability or click record. The v4 personalisation opt-in expressly enables Service improvement analytics while personalisation is active because eligible reading signals support both operational measurement and private recommendation ranking. It does not enable Sponsor measurement or every possible analytics purpose.

## 2. Purposes and necessity

First-party feed and comment analytics measure content and community-card engagement and support product improvement. When personalisation is enabled, eligible reading signals also inform that account's private recommendation profile. The updated consent model makes this explicit: personalisation enables Service improvement analytics, which remains locked until personalisation is withdrawn; the profile refresher checks both consent records. Sponsor measurement remains separate. If declined, sponsor delivery continues with campaign/day served aggregates only, without visitor/session identifiers or client-side viewability/click tracking. Existing v3 personalisation opt-ins must be renewed under the new disclosure.

When Service improvement analytics is enabled, Vercel Web Analytics provides broader site traffic reporting, including signed-out visits. Vercel Speed Insights measures real-world performance and Core Web Vitals. Neither provider stream is merged into CathoScroll's account-linked topic-event tables.

## 3. Data flows and categories

### 3.1 Signed-in first-party feed analytics

The topic feed records impressions, viewable impressions, active duration, skips, slide depth, completions and return visits. The Top Comments feed records card impressions, viewability, active duration, skips, meaningful-view completions and discussion opens.

Raw events are associated with the authenticated account and include the topic or comment identifier, event/session identifiers, event type, limited event metadata and server receipt time. The private database stores raw event streams and a private daily viewer bridge for up to 180 days. Daily rollups contain aggregate counts without account or session identifiers and are retained longer. Sponsor reporting remains a separate pipeline; sponsors do not receive raw user-level topic or comment activity. Opted-in signed-in sponsor event attribution may record the topic placement identifier alongside account/session-linked event data; that context may reveal religious or philosophical interests. Treat this as a potential special-category risk and require explicit consent under Article 9(2)(a) where the controller determines the revealing test is met, or remove topic-level attribution if that condition is not approved. Signed-out visitors do not generate sponsor viewability/click/frequency events.

These records are account-linked personal data, not anonymous data. They record defined engagement measurements for internal product analytics. When personalisation is enabled, a separate private recommendation profile also derives content-interest scores from eligible reading events. Those scores are not religious-affiliation labels or classifications, but may reveal interests in sensitive topics. They are used only to rank that user's own feed and are never shared with sponsors or used for sponsor targeting.

### 3.2 Signed-out topic and comment analytics

Signed-out visitors use a separate first-party endpoint. It accepts bounded topic/comment event batches after same-origin/native request validation and API rate limiting. Events contain a random event UUID, entity type and entity ID, event type and (for active duration) a capped duration. The endpoint does not accept or store an account ID, raw session ID, persistent visitor ID, user-agent fingerprint or client timestamp. Event UUID receipts are retained for up to 30 days for idempotency, then removed by a 15-minute cleanup job in batches of up to 5,000 rows per table per run. On the website, unsent batches remain in page memory and are discarded when the page ends. Native apps persist unsent batches in app-private SQLite, capped at 2,000 events and seven days, to survive app termination. The queue contains no account, visitor or session identifier, sends no account cookies or bearer token, and is on by default independently of optional Service improvement consent. A simple, free objection control on the Privacy and Cookie Policy pages stops collection and clears pending rows. The controller must assess this native storage under the PECR Schedule A1 statistical-purposes exception before release. The database stores UTC daily counts by entity for impressions, viewable impressions, active duration, skips, completions and comment opens. No anonymous unique-person or session metric is calculated.

The event-level receipt ledger is not linked to a visitor. The entity-level aggregate records daily counts for a topic or comment without identifying who viewed it. The anonymous endpoint also uses a keyed HMAC of the trusted request IP in a separate abuse-prevention rate-limit table; it is not joined to event aggregates and stale entries are eligible for cleanup after two days. Hosting/API logs and IP-based rate-limiting data require a separate retention and access review.

The anonymous aggregate table is retained for long-term reporting and contains no user/session identifiers. Vercel Web Analytics and Speed Insights remain separate provider streams and are not merged into the first-party event tables.

### 3.3 Vercel Web Analytics

Vercel states that Web Analytics does not use third-party cookies and uses a hash derived from the incoming request for short-lived visitor measurement, discarding that hash after 24 hours. Its documented data points may include timestamps, URLs, referrers, filtered query parameters, approximate geolocation, device type and browser/OS information.

CathoScroll's `beforeSend` hook preserves ordinary page-level reporting but replaces topic, category and search identifiers with generic route labels, and removes query strings and fragments. The site's `strict-origin` Referrer-Policy limits browser-supplied referrer information to the referring origin. This reduces disclosure of sensitive content paths but does not remove all request metadata processed by Vercel or the hosting infrastructure.

### 3.4 Vercel Speed Insights

Speed Insights is enabled to measure Core Web Vitals and page performance. Vercel describes its data points as anonymous and says the product does not collect information designed to identify a visitor or reconstruct a browsing session. Its published fields include route and URL, network speed, browser, device type, operating system, country, web-vital values and element attribution.

CathoScroll applies a `beforeSend` hook to remove query strings and fragments and replace topic, category and search identifiers with generic route labels before transmission. This is a performance measurement stream, not an account-linked reading-history system. Provider documentation and the current implementation should be rechecked when the SDK is upgraded.

## 4. UK GDPR Article 6

A lawful basis under Article 6 must be documented for each purpose. Legitimate interests may be considered for proportionate service measurement and product improvement, but should be supported by a written assessment of purpose, necessity, user expectations, impact and safeguards. Contract may apply to processing objectively necessary to provide a feature requested by a user. The correct basis must be selected and recorded by the controller rather than assumed in this technical assessment.

The controller must record the Article 6 basis selected for each purpose. Personalisation and Service improvement analytics are distinct purposes, but the personalisation opt-in expressly enables Service improvement analytics because eligible reading signals serve both operational measurement and private recommendation ranking while personalisation is active. The Service improvement control remains locked during that period and can be withdrawn independently after personalisation is turned off. Sponsor measurement remains separate. This technical assessment does not itself select or certify a lawful basis.

## 5. PECR and device storage/access

The website's signed-in and signed-out topic/comment retry queues and signed-in per-placement sponsor event IDs are held in memory only. Android and Electron persist signed-in topic/comment analytics in the encrypted private activity database, capped at 2,000 events per stream and seven days; the queue is account-scoped and cleared on sign-out/account switch. Native apps persist the signed-out topic/comment retry queue in app-private catalogue SQLite for up to seven days, capped at 2,000 events, by default and independently of optional account-linked analytics. A free objection control on the Privacy and Cookie Policy pages clears pending rows. Both native queues require a documented PECR terminal-equipment assessment; signed-in sponsor measurement is not anonymous and must not rely on the statistical-purposes exception. The Vercel Web Analytics integration is documented by Vercel as not using third-party cookies; the URL-redaction hooks do not themselves create browser storage. The controller must assess the native outbox under PECR and verify deployed SDK behaviour. Essential authentication, offline learning data and user preferences must remain purpose-limited and must not be repurposed as analytics identifiers.

## 6. Safeguards and proportionality

- Keep signed-in and signed-out ingestion paths separate. The anonymous route validates event shape, bounds payload size and duration, checks same-origin/native requests and applies API rate limits.
- Keep raw account-linked analytics tables, viewer bridges and ingestion RPCs private, with administrator-only aggregate reporting.
- Store signed-out topic/comment activity server-side only as UTC daily entity aggregates. Do not add visitor/session IDs, device fingerprints, account IDs or cross-visit profiles. Retain event UUID receipts for 30 days for deduplication. Native clients may persist only the bounded anonymous retry outbox for up to seven days; provide and honour the free opt-out, and clear pending rows when users object.
- Keep recommendation personalisation and operational analytics distinct in purpose and disclosure, while enforcing their consent dependency: enabling personalisation enables Service improvement analytics and locks that choice until personalisation is withdrawn.
- Do not use reading activity for individual sponsor targeting.
- Do not create signed-out sponsor frequency control. Signed-out delivery uses campaign/day served aggregates only; no session token, event or frequency row is created.
- Keep sponsor campaign daily aggregates separate from organic topic analytics; sponsor dashboards expose campaign-level totals only.
- Retain signed-in raw feed/comment analytics and viewer bridges for no longer than 180 days; retain aggregate reporting without account/session identifiers.
- Remove query strings and fragments from Vercel Web Analytics and Speed Insights events; replace topic, category and search identifiers with generic route labels.
- Keep the strict-origin referrer policy to avoid transmitting full referring-page paths.
- Verify deployed web and native network requests, API origins, CORS behaviour and SDK behaviour after changes or upgrades.
- Review Vercel's DPA, subprocessors, retention, international transfer safeguards and relevant project settings.
- Review hosting, CDN, WAF and function logs, including IP, URL, referrer and user-agent retention; minimise what is configurable and document security logging separately.
- Apply minimum cohort thresholds and suppression where aggregate reports could single out a person, especially for small topics or narrow time windows.
- Keep sponsor campaign analytics aggregate-only and do not expose account-level topic/comment histories to sponsors.

## 7. Risk assessment

| Risk | Mitigation | Residual position |
|---|---|---|
| Account-linked analytics are accessed or reused outside their stated purpose | Restricted private storage, authentication, bounded retention and purpose separation | Reduced by access controls; review permissions and use periodically |
| Signed-out activity is linked to an identifiable visitor | No account/session/persistent visitor ID in aggregate event path; event receipts contain only event UUIDs; hosting logs reviewed separately | Reduced for database aggregates; request logs still require review |
| Sensitive paths or search terms reach analytics providers | Route-label replacement, query/hash removal and strict-origin referrer policy | Reduced; verify deployed requests and infrastructure logs |
| Small aggregate counts expose an individual | Account-free rollups, cohort thresholds and suppression | Depends on report dimensions and traffic volume |
| Personalisation consent is confused with operational analytics | Distinct purposes and accurate policy wording | Low if notices and implementation remain aligned |
| Provider transfers or infrastructure logs expose excess metadata | DPA/subprocessor review, transfer safeguards, log minimisation | Requires provider and configuration review |

## 8. Rights, retention and transparency

The privacy notice explains the distinct signed-in and signed-out first-party analytics streams, the lack of visitor-level identifiers in signed-out daily aggregates, the account-linked Sponsor measurement opt-in and its per-placement event IDs, provider-level site/performance measurement and the separation from recommendation personalisation. Signed-in raw feed/comment events and the viewer bridge are retained for up to 180 days. Signed-out topic/comment deduplication receipts are retained for 30 days; no signed-out sponsor event/frequency rows are created; daily entity/campaign delivery aggregates are retained longer. The controller should continue to assess whether low-volume entity/day aggregates or surrounding logs could identify a person and apply suppression or deletion where needed.

Users can exercise applicable access, rectification, erasure, restriction and objection rights. Where personalisation is based on consent, users can withdraw it through Account settings; that withdrawal stops profile-based recommendation weighting and removes the derived personalisation profile. It does not automatically erase operational analytics records that have a separately documented purpose and lawful basis.

## 9. Conclusion and remaining actions

The implementation now records signed-in topic/comment events in account-linked tables and signed-out topic/comment events only as daily entity aggregates. The latter do not support anonymous unique-person counts. Signed-out sponsor delivery records campaign/day served totals only, without session identifiers or detailed event measurement. The Admin Analytics hub, topic/category pages, sponsor/comment detail pages, admin campaign manager and sponsor portal present signed-in and anonymous counts separately. Vercel Web Analytics and Speed Insights remain separate provider streams.

The principal remaining governance tasks are to document the Article 6 basis for each operational analytics purpose, review whether entity/day aggregates and infrastructure request logs could identify people in context, and complete provider, transfer and log-retention reviews. This is not a legal sign-off or a claim that every data flow is anonymous.

## 10. Sponsor analytics

Sponsor campaign delivery, viewability, click analytics and frequency controls are a separate pipeline. Authenticated and signed-out delivery are counted in separate daily aggregates; sponsor representatives receive campaign-level totals with signed-in and anonymous delivery counts distinguished. Only opted-in signed-in accounts generate raw sponsor viewability/click/frequency events, which are pruned after 180 days by the cleanup job; signed-out campaign/day delivery aggregates are retained without event or session rows. Sponsors do not receive raw session hashes, user-level event records or topic/comment browsing histories, and campaign selection is based on campaign eligibility/targeting settings rather than individual reading histories. This assessment does not certify the lawful basis; the controller must document the Article 6 basis for each purpose.

## 11. Controller action list

1. Record an Article 6 basis for each analytics purpose and complete a legitimate-interests assessment where Article 6(1)(f) is selected.
2. Review Vercel's applicable processor terms, DPA, subprocessors, transfer safeguards, retention and project settings. No paid sponsor campaigns are currently active; the owner intends to move to an appropriate commercial plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service.
3. Verify deployed Web Analytics and Speed Insights network events, route redaction and SDK versions.
4. Review CDN, WAF, hosting and function logs, including IP, URL, referrer and user-agent retention.
5. Confirm aggregate dashboard suppression for low-volume data and keep sponsor access aggregate-only.
6. Revisit this assessment after material changes and at least annually.

**Approval record:** This is a provisional internal assessment. The controller should record the reviewer, date, selected lawful bases, provider/transfer checks and any accepted residual risks before treating the review as complete.


## 12. Anonymous analytics and signed-out sponsorship — implemented controls

The signed-out topic and Top Comments path posts event UUID, entity type/ID and bounded event metrics to the anonymous analytics endpoint. The server checks same-origin/native requests, bounds request size and batch length, applies rate limiting, and calls a service-role-only database function. The database validates event types and IDs, caps active-duration values, deduplicates receipts for 30 days and writes UTC daily entity aggregates without account IDs, raw session IDs or persistent visitor IDs. Website retry batches remain in memory. Native retry batches use a bounded seven-day app-private SQLite outbox, with a user-facing opt-out that clears queued rows.

Signed-out sponsor selection uses a dedicated service-role-only database function and campaign/day aggregates. It does not create a session token, viewability/click event or frequency row. Detailed sponsor measurement is restricted to opted-in signed-in accounts; their account-linked event and frequency rows, including per-placement event IDs, are eligible for deletion after 180 days by a 15-minute cleanup job, which processes up to 5,000 rows per table per run. Campaign approval, sponsor/payment status, dates, targeting, placement weights and daily/total caps remain enforced. Signed-in and anonymous sponsor metrics are reported separately in Admin Analytics, the admin campaign manager and sponsor portal.

The shared topic viewer, TopCommentFeedCard and SponsorFeedCard are used by web and native. Native requests use the configured CathoScroll API origin rather than the Capacitor local origin. This implementation has not yet been manually verified on physical Android/Electron builds; automated CI and deployed acceptance must be checked separately.

These controls reduce direct attribution. Article 6 basis, PECR, infrastructure logs and provider/transfer review remain controller tasks. No anonymous unique-person count is calculated or shown.

## 13. Updated legal, PECR and processor review — 20 November 2026

This section records the current technical review and the relevant ICO guidance in force on the assessment date. It is not a legal opinion, a signed legitimate-interests assessment, or controller approval.

### 13.1 Purpose-by-purpose Article 6 position

| Processing purpose | Article 6 position | Status |
|---|---|---|
| Account-linked topic-feed and Top Comments event records | Article 6(1)(f) legitimate interests may be considered for proportionate internal service measurement, reliability and product improvement. A completed purpose/necessity/balancing test is required; contract is not a blanket basis for optional analytics. | Controller must document and approve the selected basis. |
| Optional recommendation personalisation | Article 6(1)(a) consent. | Purpose-specific signup and Account opt-in exists; maintain separation from operational analytics. |
| Signed-out topic/comment daily aggregates | Record the applicable basis for associated request/log processing. The stored daily aggregate contains no visitor/session/account identifiers and is not used to create individual profiles. | Review aggregate suppression and surrounding request logs periodically. |
| Sponsor delivery and performance records | Select and document a basis for delivery, fraud prevention, billing/reconciliation and campaign reporting separately. Contract may cover processing objectively necessary to deliver an agreed sponsor campaign; legitimate interests may cover proportionate security and aggregate reporting after a balancing test. | Separate pipeline exists; keep campaign reporting aggregate-only. |
| Vercel site/performance analytics | Document the applicable basis for provider-generated/request metadata and ensure the provider role is correctly identified. | Provider contract and transfer review remain operational tasks. |

Operational topic/comment analytics are used for engagement measurement, reliability and product improvement. They do not calculate belief labels or profiles, make individual decisions, or use events for sponsor targeting. The optional recommendation-personalisation profile is a separate feature and is not exposed to sponsors.

### 13.2 PECR and the statistical-purposes exception

A source review of the current clients found:

- website signed-in and signed-out topic/comment event batches are held in module memory only; Android and Electron persist signed-in topic/comment/sponsor events in the encrypted private activity database (2,000 per stream, seven-day expiry, account-scoped and cleared on sign-out/account change); native apps separately persist signed-out events in app-private catalogue SQLite for up to seven days, with a 2,000-event cap and a free opt-out that clears pending rows;
- signed-out sponsor measurement is disabled; campaign/day served aggregates continue without session tokens or event-level viewability/click/frequency records;
- Vercel Web Analytics is documented by Vercel as not using third-party cookies and as discarding its request-derived visitor hash after 24 hours;
- Web Analytics and Speed Insights beforeSend handlers remove query strings/fragments and replace topic, category and search paths with generic labels.

CathoScroll does not intentionally place an analytics cookie or persist an analytics identifier in browser localStorage, sessionStorage or IndexedDB. Native apps persist anonymous topic/comment event payloads in app-private SQLite and account-linked topic/comment events in the encrypted private database. The latter remain personal data and are not anonymous; the statistical-purposes exception must not be assumed to apply to account-linked events. Both native storage paths must be assessed under Regulation 6. This is storage on terminal equipment and must be assessed under Regulation 6 even though it contains no visitor/account identifier. The statistical-purposes exception may apply only if its full conditions are met: sole service-improvement statistics purpose, no individual monitoring or advertising measurement, prompt aggregation/deletion, clear notice and a simple/free objection route. The Privacy and Cookie Policy pages provide a direct, simple and free objection control that stops anonymous aggregate collection and clears queued events. The controller must record the legal assessment and verify deployed web/native storage behaviour before claiming PECR clearance.

The ICO finalised its updated storage/access guidance on 29 April 2026. Its statistical-purposes exception is narrow: it requires an ISS provider, an exclusive statistical service-improvement purpose, aggregate statistical output that is not personal data, no use for decisions about individuals, prompt aggregation and deletion of individual-level inputs when no longer needed, clear information, and a simple and free means to object. It does not cover online-advertising purposes, including ad measurement/performance and frequency capping, even when the resulting report is aggregate or contains no visitor identity. Do not rely on this exception for sponsor viewability, click, CTR or frequency measurement; obtain the separate Sponsor measurement consent before running those technologies. See [ICO storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/) and [the statistical-purposes exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

### 13.3 Verified provider and retention facts

- Supabase project region is eu-north-1 (Stockholm). This locates the primary Postgres/Auth/Storage services; it does not prove that backups, logs, support access or subprocessors remain in that region.
- The connected Supabase project is on the Free plan. Current published plan information states API/database log retention is one day and Auth audit-log access is 24 hours; automatic database backups and point-in-time recovery are not included on Free. Supabase's DPA is available, but acceptance by this project/controller has not been verified. Review the [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [GDPR guide](https://supabase.com/docs/guides/security/gdpr-compliance), and [plan comparison](https://supabase.com/pricing).
- The connected Vercel team is on Hobby. Vercel's published plan terms, DPA availability and data-use provisions should remain in the controller's provider/transfer review. The Hobby plan includes one month of Web Analytics history; Vercel's documented request-derived visitor hash is discarded after 24 hours and runtime logs have a separate retention window. No paid sponsor campaigns are currently active; the owner intends to move to an appropriate commercial plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service. See [Vercel Terms](https://vercel.com/legal/terms), [Hobby Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines), and [Vercel DPA](https://vercel.com/legal/dpa).
- Vercel's current deployment on main is READY, but the logo-free PR branch is not deployed. The temporary sponsor-logo compatibility bridge is therefore still required by the currently deployed client and must not be removed from the live database yet.

### 13.4 Provider actions and release gates

1. Confirm and record acceptance of the Supabase DPA; inspect the subprocessor list, transfer impact assessment and all transfer mechanisms. The primary region being Stockholm is not a complete transfer analysis.
2. Complete the planned hosting-plan change before accepting paid sponsorship revenue, and review the applicable processor agreement and international-transfer safeguards. This is not a blocker to the current pre-revenue service.
3. Review Supabase Auth audit-log storage, database/API logs, function logs and Vercel runtime/build logs. Supabase Free API/database logs are retained for one day and Auth audit-log access for 24 hours; Vercel Hobby runtime logs are retained for one hour, Web Analytics history is one month, and its request-derived visitor hash is discarded after 24 hours. These short windows are not a substitute for an incident-response retention policy.
4. Record that Supabase Free has no automatic backups or PITR; establish a tested, encrypted backup/export and restore process before relying on this as production storage.
5. Record the selected Article 6 basis for account-linked operational analytics and sponsor records before treating this DPIA as approved.
6. Verify deployed network traffic and device storage behaviour on web and native builds, including all Vercel SDK requests and browser storage APIs.
7. Keep the sponsor-logo compatibility bridge until the logo-free application is deployed and verified; then run the existing docs/sponsor-logo-removal.sql and confirm the old RPC signature and logo payload are absent.

**Status:** technical review updated; controller legal approval, provider-contract acceptance, hosted MFA cleanup, production deployment and post-deployment bridge removal remain outstanding.


## 14. Controller draft assessment and proposed consent model

The detailed purpose-by-purpose engineering assessment, including the proposed Article 6/Article 9 position, sponsor opt-out fallback, PECR analysis, DPIA risk register and controller approval checklist, is maintained in [UK GDPR analytics assessment](./uk-gdpr-analytics-assessment.md). It is a draft for controller review, not a signed DPIA or legal opinion.

The recommended design is to retain the existing event taxonomy and aggregate reporting while separating account-linked service analytics from sponsor measurement. When personalisation is enabled, its explicit opt-in also enables Service improvement analytics and the service choice is locked until personalisation is withdrawn. When personalisation is off, account-linked topic/comment activity requires its own optional explicit Service improvement choice that explains the religious-content context and may reveal religious/philosophical beliefs. Sponsor measurement has its own optional choice. Signed-out daily aggregate statistics are a separate default-on statistical stream with a simple free objection, subject to the PECR Schedule A1 conditions. If sponsor measurement is declined, retain only campaign/day served-placement totals without visitor/session identifiers; do not record client viewability, clicks, CTR, or per-person frequency for that visitor. Keep recommendation personalisation on its existing separate signup and Account controls.

Do not disable login, account synchronisation, bookmarks, likes, progress, notes, general feed ranking or sponsor delivery when optional analytics is declined. The controller must approve the Article 6 basis, any Article 9 condition, PECR Regulation 6 route, retention and residual DPIA risk before production enablement.

## Consent and withdrawal controls in the proposed release

The separate global consent implementation was merged in PR #25 and deployed to production in commit `e0da259` on 20 November 2026. Its three database migrations are recorded as applied in production. Browser/native end-to-end verification and controller approval remain separate outstanding checks:

- Service improvement analytics and Sponsor measurement are distinct purposes with separate controls. Service improvement analytics is off by default when personalisation is off, and automatically on/locked while personalisation is enabled. Sponsor measurement is always optional and independent. Signed-out daily aggregates are separate and on by default with a simple free objection. The choices are presented at signup and inline in Account settings; there is no first-visit popup. Signed-out aggregate measurement has a separate free objection control on the Privacy and Cookie Policy pages.
- The service-improvement choice explicitly explains that signed-in topic/comment engagement is account-linked and may reveal religious or philosophical beliefs. The controller must confirm the Article 6 basis and, where the actual processing reveals special-category beliefs, rely on a valid Article 9 condition. The explicit-consent wording is a control proposal, not a substitute for controller/legal approval.
- Sponsor measurement is separately explicit. Opted-in signed-in sponsor event attribution includes the topic placement where the sponsor appeared, which may reveal religious/philosophical interests; no signed-out sponsor event attribution is collected. Where that context meets the Article 9 revealing test, the controller must approve explicit consent under Article 9(2)(a) alongside Article 6(1)(a), or remove topic-level attribution before enabling the measurement.
- Signed-in choices are stored in a private account consent table with a change-history record. Server ingestion RPCs and API routes fail closed unless the relevant purpose is enabled. Signed-out choices are kept separately on the device and do not create a visitor or account identifier.
- Withdrawal takes effect locally immediately, clears the matching pending web/native event queues, prevents future flushes and synchronises signed-in changes when connectivity returns. Personalisation withdrawal deletes the derived recommendation profile and stops recommendation use of reading signals. Service improvement analytics remains enabled until the user independently withdraws it after personalisation is off. The separate signed-out topic/comment aggregate stream continues unless the user objects through the Privacy or Cookie Policy control. If Sponsor measurement is declined, only server-side campaign/day served aggregates continue; no sponsor session token, frequency, viewability or click records are created.
- Vercel Web Analytics and Speed Insights are rendered only when the matching service-improvement choice is enabled.
- Sponsor delivery continues when sponsor measurement is declined. The selector still increments campaign/day served totals for delivery and pacing, but does not generate a visitor/session token, create session/user frequency rows, or record client viewability/click events. Consequently no per-person frequency, unique reach or CTR is calculated for opted-out placements. Campaign-level caps remain active.

The three migrations represented by docs/analytics-consent-and-sponsor-opt-out-upgrade.sql have been applied to the production Supabase database. The initial consent DDL was first executed in a transaction against the existing production schema and rolled back; consent and sponsor-selector smoke tests were also run in a separate rolled-back transaction. The two lock-order follow-up migrations were then applied and the live function definitions and privileges were verified. The documentation upgrade copy has not been separately executed, and the clean-install bootstrap has not been run against a disposable PostgreSQL database because no separately billed Supabase branch was created. The matching application UI and API/client code are deployed in production in commit `e0da259`. Browser/native end-to-end verification remains outstanding. Controller approval of Article 6/Article 9 bases, PECR treatment and residual DPIA risk remains outstanding.
