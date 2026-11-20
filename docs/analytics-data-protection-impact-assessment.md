# CathoScroll analytics data protection impact assessment

**Assessment date:** 19 November 2026  
**Status:** Provisional internal assessment; not a legal opinion or a declaration of regulatory compliance.  
**Owner/controller:** CathoScroll's operator.  
**Review trigger:** Material changes to analytics purposes, data fields, vendors or retention, and at least annually.

## 1. Processing under review

This assessment covers first-party account-linked analytics for signed-in topic-feed and Top Comments activity; separate signed-out topic/comment daily aggregates; authenticated and anonymous sponsor delivery analytics; Vercel Web Analytics and Speed Insights; and recommendation personalisation as a separate purpose controlled by the account setting.

Signed-in topic/comment events remain account-linked. Signed-out topic/comment events are stored only as daily aggregates without account IDs, raw session IDs or persistent visitor IDs. Sponsor frequency protection uses a random token held in page memory and stores only its SHA-256 hash for a short period. The personalisation checkbox controls recommendation profiling only; it is not blanket consent for operational analytics.

## 2. Purposes and necessity

First-party feed and comment analytics help measure whether content and community cards are being seen and used, identify product issues, understand engagement and improve the service. The existing analytics dashboard reports overall, category, topic, comment and sponsor performance. The recommendation system separately uses eligible account activity only where personalisation is enabled.

Vercel Web Analytics provides broader site traffic reporting, including signed-out visits. Vercel Speed Insights measures real-world performance and Core Web Vitals. Neither provider stream is merged into CathoScroll's account-linked topic-event tables.

## 3. Data flows and categories

### 3.1 Signed-in first-party feed analytics

The topic feed records impressions, viewable impressions, active duration, skips, slide depth, completions and return visits. The Top Comments feed records card impressions, viewability, active duration, skips, meaningful-view completions and discussion opens.

Raw events are associated with the authenticated account and include the topic or comment identifier, event/session identifiers, event type, limited event metadata and server receipt time. The private database stores raw event streams and a private daily viewer bridge for up to 180 days. Daily rollups contain aggregate counts without account or session identifiers and are retained longer. Sponsor reporting remains a separate pipeline; sponsors do not receive raw user-level topic or comment activity.

These records are account-linked personal data, not anonymous data. Topic activity on a Catholic learning service may reveal or permit inferences about religious or philosophical beliefs. Treat the information as potentially special-category data and restrict access accordingly.

### 3.2 Signed-out topic and comment analytics

Signed-out visitors use a separate first-party endpoint. It accepts bounded topic/comment event batches after same-origin/native request validation and API rate limiting. Events contain a random event UUID, entity type and entity ID, event type and (for active duration) a capped duration. The endpoint does not accept or store an account ID, raw session ID, persistent visitor ID, user-agent fingerprint or client timestamp. Event UUID receipts are retained for up to 30 days for idempotency, then removed by a 15-minute cleanup job in batches of up to 5,000 rows per table per run. A bounded local browser/native queue stores unsent event IDs and topic/comment event payloads so batches can retry after app restart; it does not contain a visitor/session identifier. The controller must assess this analytics-related device storage under PECR before launch. The database stores UTC daily counts by entity for impressions, viewable impressions, active duration, skips, completions and comment opens. No anonymous unique-person or session metric is calculated.

The event-level receipt ledger is not linked to a visitor, but the entity-level aggregate can still reveal that a particular topic or comment was viewed on a particular day. In the context of a Catholic learning platform, topic/comment identifiers may be sensitive inferences. The absence of a visitor identifier reduces individual attribution; it does not, by itself, prove that all surrounding request processing or logs are anonymous. The anonymous endpoint also uses a keyed HMAC of the trusted request IP in a separate abuse-prevention rate-limit table; it is not joined to event aggregates and stale entries are eligible for cleanup after two days. Hosting/API logs and IP-based rate-limiting data require a separate retention and access review.

The anonymous aggregate table is retained for long-term reporting and contains no user/session identifiers. Vercel Web Analytics and Speed Insights remain separate provider streams and are not merged into the first-party event tables.

### 3.3 Vercel Web Analytics

Vercel states that Web Analytics does not use third-party cookies and uses a hash derived from the incoming request for short-lived visitor measurement, discarding that hash after 24 hours. Its documented data points may include timestamps, URLs, referrers, filtered query parameters, approximate geolocation, device type and browser/OS information.

CathoScroll's `beforeSend` hook preserves ordinary page-level reporting but replaces topic, category and search identifiers with generic route labels, and removes query strings and fragments. The site's `strict-origin` Referrer-Policy limits browser-supplied referrer information to the referring origin. This reduces disclosure of sensitive content paths but does not remove all request metadata processed by Vercel or the hosting infrastructure.

### 3.4 Vercel Speed Insights

Speed Insights is enabled to measure Core Web Vitals and page performance. Vercel describes its data points as anonymous and says the product does not collect information designed to identify a visitor or reconstruct a browsing session. Its published fields include route and URL, network speed, browser, device type, operating system, country, web-vital values and element attribution.

CathoScroll applies a `beforeSend` hook to remove query strings and fragments and replace topic, category and search identifiers with generic route labels before transmission. This is a performance measurement stream, not an account-linked reading-history system. Provider documentation and the current implementation should be rechecked when the SDK is upgraded.

## 4. UK GDPR Article 6 and Article 9

A lawful basis under Article 6 must be documented for each purpose. Legitimate interests may be considered for proportionate service measurement and product improvement, but should be supported by a written assessment of purpose, necessity, user expectations, impact and safeguards. Contract may apply to processing objectively necessary to provide a feature requested by a user. The correct basis must be selected and recorded by the controller rather than assumed in this technical assessment.

Where account-linked topic activity reveals or permits inferences about religious or philosophical beliefs, an Article 9 condition is also required. The personalisation checkbox is purpose-specific: it records explicit consent to use reading activity and selected interests to personalise recommendations. It should not be presented as blanket consent for unrelated operational analytics.

The controller should obtain UK data-protection advice on whether the operational topic/comment analytics constitute special-category processing in the particular context, and identify the Article 9 condition that genuinely fits the operational purpose. Explicit consent under Article 9(2)(a) is one possible route, but would need to be specific, informed, freely given, clearly affirmed and withdrawable. Other Article 9 conditions should only be relied on where their statutory requirements are actually met. This assessment does not invent or certify an Article 9 condition.

This review is an outstanding governance action; it does not change the current product behaviour or mean that the recommendation personalisation setting has been repurposed as analytics consent.

## 5. PECR and device storage/access

The Vercel Web Analytics integration is documented by Vercel as not using third-party cookies. The URL-redaction hooks do not themselves create browser storage. First-party topic/comment queues are account-scoped and used for authenticated analytics delivery. The controller should verify the deployed SDK behaviour and assess any device-storage/access requirements under PECR, including whether any analytics-related local storage is strictly necessary or requires consent. Essential authentication and preference storage must not be repurposed as an analytics identifier.

## 6. Safeguards and proportionality

- Keep signed-in and signed-out ingestion paths separate. The anonymous route validates event shape, bounds payload size and duration, checks same-origin/native requests and applies API rate limits.
- Keep raw account-linked analytics tables, viewer bridges and ingestion RPCs private, with administrator-only aggregate reporting.
- Store signed-out topic/comment activity only as UTC daily entity aggregates. Do not add visitor/session IDs, device fingerprints, account IDs or cross-visit profiles. Retain event UUID receipts for 30 days for deduplication; keep a bounded local retry queue without visitor/session identifiers and document its PECR basis.
- Keep recommendation personalisation separate from operational analytics in purpose, user-facing wording and account controls.
- Do not use reading activity or inferred religious interests for individual sponsor targeting.
- Keep signed-out sponsor frequency control separate: generate a random token in page memory, store only its SHA-256 hash, and prune raw event/frequency rows after 30 days.
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
| Account-linked topic activity reveals religious/philosophical interests | Restricted private storage, authentication, bounded retention, separate personalisation controls, Article 9 review | Requires controller's documented Article 9 decision |
| Signed-out activity is linked to an identifiable visitor | No account/session/persistent visitor ID in aggregate event path; event receipts contain only event UUIDs; hosting logs reviewed separately | Reduced for database aggregates; request logs still require review |
| Sensitive paths or search terms reach analytics providers | Route-label replacement, query/hash removal and strict-origin referrer policy | Reduced; verify deployed requests and infrastructure logs |
| Small aggregate counts expose an individual | Account-free rollups, cohort thresholds and suppression | Depends on report dimensions and traffic volume |
| Personalisation consent is confused with operational analytics | Distinct purposes and accurate policy wording | Low if notices and implementation remain aligned |
| Provider transfers or infrastructure logs expose excess metadata | DPA/subprocessor review, transfer safeguards, log minimisation | Requires provider and configuration review |

## 8. Rights, retention and transparency

The privacy notice explains the distinct signed-in and signed-out first-party analytics streams, the lack of visitor-level identifiers in signed-out daily aggregates, the temporary sponsor frequency hash, provider-level site/performance measurement and the separation from recommendation personalisation. Signed-in raw feed/comment events and the viewer bridge are retained for up to 180 days. Signed-out deduplication receipts are retained for 30 days; anonymous sponsor event/frequency rows are retained for no more than 30 days; daily entity/campaign aggregates are retained longer. The controller should continue to assess whether low-volume entity/day aggregates or surrounding logs could identify a person and apply suppression or deletion where needed.

Users can exercise applicable access, rectification, erasure, restriction and objection rights. Where personalisation is based on consent, users can withdraw it through Account settings; that withdrawal stops profile-based recommendation weighting and removes the derived personalisation profile. It does not automatically erase operational analytics records that have a separately documented purpose and lawful basis.

## 9. Conclusion and remaining actions

The implementation now records signed-in topic/comment events in account-linked tables and signed-out topic/comment events only as daily entity aggregates. The latter do not support anonymous unique-person counts. Signed-out sponsor delivery uses a separate campaign pipeline with hashed, short-lived frequency protection and aggregate reporting. The Admin Analytics hub, topic/category pages, sponsor/comment detail pages, admin campaign manager and sponsor portal present signed-in and anonymous counts separately. Vercel Web Analytics and Speed Insights remain separate provider streams.

The principal remaining legal task is to document the Article 6 basis and obtain advice on Article 9 applicability/condition for account-linked operational topic/comment analytics. The controller must also review whether entity/day aggregates and infrastructure request logs could identify people in context, and complete provider/transfer and log-retention reviews. This is not a legal sign-off or a claim that every data flow is anonymous.

## 10. Sponsor analytics

Sponsor campaign delivery, viewability, click analytics and frequency controls are a separate pipeline. Authenticated and signed-out delivery are counted in separate daily aggregates; sponsor representatives receive campaign-level totals with signed-in and anonymous counts distinguished. Raw anonymous sponsor event and session-frequency records are pruned after the 30-day retention threshold by a 15-minute cleanup job; campaign daily aggregates are retained. Sponsors do not receive raw session hashes, user-level event records or topic/comment browsing histories, and campaign selection is based on campaign eligibility/targeting settings rather than individual reading histories. This assessment does not certify the lawful basis; the controller must document the Article 6 basis and assess whether any processing in context engages Article 9.

## 11. Controller action list

1. Record an Article 6 basis for each analytics purpose and complete a legitimate-interests assessment where Article 6(1)(f) is selected.
2. Obtain specialist advice on whether operational topic/comment analytics process special-category data and record the applicable Article 9 condition where required.
3. Review Vercel's DPA, subprocessors, transfer safeguards, retention and project settings.
4. Verify deployed Web Analytics and Speed Insights network events, route redaction and SDK versions.
5. Review CDN, WAF, hosting and function logs, including IP, URL, referrer and user-agent retention.
6. Confirm aggregate dashboard suppression for low-volume data and keep sponsor access aggregate-only.
7. Revisit this assessment after material changes and at least annually.

**Approval record:** This is a provisional internal assessment. The controller should record the reviewer, date, selected lawful bases, Article 9 condition where applicable, provider/transfer checks and any accepted residual risks before treating the review as complete.


## 12. Anonymous analytics and signed-out sponsorship — implemented controls

The signed-out topic and Top Comments path posts event UUID, entity type/ID and bounded event metrics to the anonymous analytics endpoint. The server checks same-origin/native requests, bounds request size and batch length, applies rate limiting, and calls a service-role-only database function. The database validates event types and IDs, caps active-duration values, deduplicates receipts for 30 days and writes UTC daily entity aggregates without account IDs, raw session IDs or persistent visitor IDs. A bounded local retry queue persists unsent event payloads but does not create an identity or session key.

Signed-out sponsor selection and event recording use dedicated service-role-only database functions and separate daily campaign aggregates. A random session token is held only in page memory; its SHA-256 hash is stored for session-frequency control. Raw anonymous sponsor event and session-frequency rows are eligible for deletion after 30 days by a 15-minute cleanup job, which processes up to 5,000 rows per table per run. Campaign approval, sponsor/payment status, dates, targeting, placement weights and daily/total caps remain enforced. Signed-in and anonymous sponsor metrics are reported separately in Admin Analytics, the admin campaign manager and sponsor portal.

The shared topic viewer, TopCommentFeedCard and SponsorFeedCard are used by web and native. Native requests use the configured CathoScroll API origin rather than the Capacitor local origin. This implementation has not yet been manually verified on physical Android/Electron builds; automated CI and deployed acceptance must be checked separately.

These controls reduce direct attribution but do not automatically settle legal classification. Topic/comment IDs and request metadata can remain sensitive in context. Article 6 basis, Article 9 applicability/condition where relevant, PECR, infrastructure logs and provider/transfer review remain controller tasks. No anonymous unique-person count is calculated or shown.
