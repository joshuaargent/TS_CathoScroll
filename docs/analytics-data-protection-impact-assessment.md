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

Signed-out visitors use a separate first-party endpoint. It accepts bounded topic/comment event batches after same-origin/native request validation and API rate limiting. Events contain a random event UUID, entity type and entity ID, event type and (for active duration) a capped duration. The endpoint does not accept or store an account ID, raw session ID, persistent visitor ID, user-agent fingerprint or client timestamp. Event UUID receipts are retained for up to 30 days for idempotency, then removed by a 15-minute cleanup job in batches of up to 5,000 rows per table per run. Unsent event batches remain in page/app memory only and are not written to browser storage, session storage or IndexedDB. Events still pending when the page or app process ends are discarded. The controller must still assess all other device storage/access technologies under PECR before launch. The database stores UTC daily counts by entity for impressions, viewable impressions, active duration, skips, completions and comment opens. No anonymous unique-person or session metric is calculated.

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

An Article 9 condition is required if the account-linked topic activity is special-category data. Under the ICO's October 2026 guidance, an inference about religious or philosophical belief is special-category data where the processing intentionally draws that inference or intentionally treats someone differently because of it; mere theoretical inferability is not automatically enough. The actual topic/comment content and context may themselves reveal or concern beliefs, so the controller must assess the fields, purpose, outputs and intended use. The personalisation checkbox is purpose-specific: it records explicit consent to use reading activity and selected interests to personalise recommendations. It is not blanket consent for unrelated operational analytics.

The controller should obtain UK data-protection advice on whether the operational topic/comment analytics constitute special-category processing in the particular context, and identify the Article 9 condition that genuinely fits the operational purpose. Explicit consent under Article 9(2)(a) is one possible route, but would need to be specific, informed, freely given, clearly affirmed and withdrawable. Other Article 9 conditions should only be relied on where their statutory requirements are actually met. This assessment does not invent or certify an Article 9 condition.

This review is an outstanding governance action; it does not change the current product behaviour or mean that the recommendation personalisation setting has been repurposed as analytics consent.

## 5. PECR and device storage/access

First-party topic, Top Comments and sponsor analytics retry queues are held in page/app memory only. They are not written to browser local storage, session storage or IndexedDB and are discarded when the page or app process ends. The Vercel Web Analytics integration is documented by Vercel as not using third-party cookies; the URL-redaction hooks do not themselves create browser storage. The controller must still verify deployed SDK behaviour and assess any other device storage/access technologies under PECR. Essential authentication, offline learning data and user preferences must remain purpose-limited and must not be repurposed as analytics identifiers.

## 6. Safeguards and proportionality

- Keep signed-in and signed-out ingestion paths separate. The anonymous route validates event shape, bounds payload size and duration, checks same-origin/native requests and applies API rate limits.
- Keep raw account-linked analytics tables, viewer bridges and ingestion RPCs private, with administrator-only aggregate reporting.
- Store signed-out topic/comment activity only as UTC daily entity aggregates. Do not add visitor/session IDs, device fingerprints, account IDs or cross-visit profiles. Retain event UUID receipts for 30 days for deduplication. Keep unsent batches in memory only; do not persist analytics events to terminal equipment.
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

The principal remaining legal tasks are to document the Article 6 basis and obtain advice on Article 9 applicability/condition for account-linked operational topic/comment analytics, and to resolve the Vercel Hobby-plan contract issue. The controller must also review whether entity/day aggregates and infrastructure request logs could identify people in context, and complete provider/transfer and log-retention reviews. This is not a legal sign-off or a claim that every data flow is anonymous.

## 10. Sponsor analytics

Sponsor campaign delivery, viewability, click analytics and frequency controls are a separate pipeline. Authenticated and signed-out delivery are counted in separate daily aggregates; sponsor representatives receive campaign-level totals with signed-in and anonymous counts distinguished. Raw anonymous sponsor event and session-frequency records are pruned after the 30-day retention threshold by a 15-minute cleanup job; campaign daily aggregates are retained. Sponsors do not receive raw session hashes, user-level event records or topic/comment browsing histories, and campaign selection is based on campaign eligibility/targeting settings rather than individual reading histories. This assessment does not certify the lawful basis; the controller must document the Article 6 basis and assess whether any processing in context engages Article 9.

## 11. Controller action list

1. Record an Article 6 basis for each analytics purpose and complete a legitimate-interests assessment where Article 6(1)(f) is selected.
2. Obtain specialist advice on whether operational topic/comment analytics process special-category data and record the applicable Article 9 condition where required.
3. Confirm the Vercel plan is commercially suitable and that an applicable DPA/UK transfer mechanism is in force. The connected team is currently Hobby; Vercel's DPA applies to Pro/Enterprise, so production sponsorship must not be treated as contractually cleared until this is resolved. Review subprocessors, transfer safeguards, retention and project settings.
4. Verify deployed Web Analytics and Speed Insights network events, route redaction and SDK versions.
5. Review CDN, WAF, hosting and function logs, including IP, URL, referrer and user-agent retention.
6. Confirm aggregate dashboard suppression for low-volume data and keep sponsor access aggregate-only.
7. Revisit this assessment after material changes and at least annually.

**Approval record:** This is a provisional internal assessment. The controller should record the reviewer, date, selected lawful bases, Article 9 condition where applicable, provider/transfer checks and any accepted residual risks before treating the review as complete.


## 12. Anonymous analytics and signed-out sponsorship — implemented controls

The signed-out topic and Top Comments path posts event UUID, entity type/ID and bounded event metrics to the anonymous analytics endpoint. The server checks same-origin/native requests, bounds request size and batch length, applies rate limiting, and calls a service-role-only database function. The database validates event types and IDs, caps active-duration values, deduplicates receipts for 30 days and writes UTC daily entity aggregates without account IDs, raw session IDs or persistent visitor IDs. Unsent event batches remain in page/app memory only and are not persisted across restarts.

Signed-out sponsor selection and event recording use dedicated service-role-only database functions and separate daily campaign aggregates. A random session token is held only in page memory; its SHA-256 hash is stored for session-frequency control. Raw anonymous sponsor event and session-frequency rows are eligible for deletion after 30 days by a 15-minute cleanup job, which processes up to 5,000 rows per table per run. Campaign approval, sponsor/payment status, dates, targeting, placement weights and daily/total caps remain enforced. Signed-in and anonymous sponsor metrics are reported separately in Admin Analytics, the admin campaign manager and sponsor portal.

The shared topic viewer, TopCommentFeedCard and SponsorFeedCard are used by web and native. Native requests use the configured CathoScroll API origin rather than the Capacitor local origin. This implementation has not yet been manually verified on physical Android/Electron builds; automated CI and deployed acceptance must be checked separately.

These controls reduce direct attribution but do not automatically settle legal classification. Topic/comment IDs and request metadata can remain sensitive in context. Article 6 basis, Article 9 applicability/condition where relevant, PECR, infrastructure logs and provider/transfer review remain controller tasks. No anonymous unique-person count is calculated or shown.

## 13. Updated legal, PECR and processor review — 20 November 2026

This section records the current technical review and the relevant ICO guidance in force on the assessment date. It is not a legal opinion, a signed legitimate-interests assessment, or controller approval.

### 13.1 Purpose-by-purpose Article 6 / Article 9 position

| Processing purpose | Article 6 position | Article 9 position | Status |
|---|---|---|---|
| Account-linked topic-feed and Top Comments event records | Article 6(1)(f) legitimate interests is a candidate for proportionate internal service measurement, reliability and product improvement. A completed purpose/necessity/balancing test is required; contract is not a suitable blanket basis for analytics that is not objectively necessary to deliver the account. | Article 9 applies only if the actual records reveal/concern beliefs or the processing intentionally infers beliefs or treats people differently on that basis. If it applies, explicit consent under Article 9(2)(a) is a practical candidate, but it must be separate, specific, freely given, clearly affirmed and withdrawable. Recommendation consent does not cover operational analytics. | Not legally cleared. No separate operational-analytics consent is currently implemented. |
| Optional recommendation personalisation | Article 6(1)(a) consent. | Article 9(2)(a) explicit consent for the relevant belief-related profile. | Purpose-specific signup and Account opt-in exists; maintain separation from operational analytics. |
| Signed-out topic/comment daily aggregates | If the output is genuinely anonymous aggregate data, UK GDPR lawful-basis/Article 9 requirements do not apply to that output. Any identifiable request/log data still needs a basis. | No person-level belief inference should be created from these aggregates. Small counts and narrow topic/day combinations require suppression or aggregation. | Lower attribution risk, but anonymity and surrounding request logs require periodic verification. |
| Sponsor delivery and performance records | Select and document a basis for delivery, fraud prevention, billing/reconciliation and campaign reporting separately. Contract may cover processing objectively necessary to deliver an agreed sponsor campaign; legitimate interests may cover proportionate security and aggregate reporting after a balancing test. | Any account-linked sponsor event carrying a topic placement identifier must be treated as potentially sensitive in context. Do not use individual religious-interest profiles for sponsor targeting. | Separate pipeline exists; confirm user-level fields and access remain necessary and minimise them. |
| Vercel site/performance analytics | Document the applicable basis for provider-generated/request metadata and ensure the provider role is correctly identified. | Route redaction reduces exposure but does not itself decide whether provider-side request metadata is special-category data. | Provider contract and transfer review incomplete on Hobby. |

The ICO's October 2026 guidance confirms that inferred religious/philosophical beliefs are special-category data where the processing intentionally draws that inference or intentionally treats a person differently because of it. Mere theoretical ability to infer a belief from a data point does not automatically make every such record special-category data. However, topic/comment event content and context may themselves reveal or concern beliefs. The controller must assess the actual fields, purposes, outputs, aggregation, and intended uses; it is not sufficient to say only that the system does not use the data for recommendations. If special-category data is processed, both an Article 6 basis and a separate Article 9 condition are required. See the ICO's [special-category data guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/) and [rules on special-category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/).

**Recommended controller decision:** do not rely on the recommendation checkbox as consent for operational analytics. Either (a) introduce a separate optional, unticked operational-analytics consent and gate all account-linked topic/comment and topic-linked sponsor event ingestion on that consent, or (b) remove account/session linkage from those measurement pipelines and use anonymous aggregate-only reporting. If neither route is adopted, obtain qualified advice identifying a different Article 9 condition that genuinely applies before continuing the potentially special-category account-linked processing. Article 6 legitimate interests alone is not enough where Article 9 applies.

A legitimate-interests assessment for any Article 6(1)(f) purpose must identify the precise interest, show necessity (including why aggregate-only data is insufficient), balance user expectations and impact, record safeguards and objections, and be approved by the controller. This document records the candidate basis but does not claim that the balancing test has been passed.

### 13.2 PECR and the statistical-purposes exception

A source review of the current clients found:

- signed-out topic/comment event batches are held in module memory only and retried while the page/app process remains alive; they are not written to localStorage, sessionStorage or IndexedDB;
- the signed-out sponsor frequency token is held in page memory; only its SHA-256 hash is stored server-side;
- Vercel Web Analytics is documented by Vercel as not using third-party cookies and as discarding its request-derived visitor hash after 24 hours;
- Web Analytics and Speed Insights beforeSend handlers remove query strings/fragments and replace topic, category and search paths with generic labels.

On the source reviewed, CathoScroll does not intentionally place an analytics cookie or persist a first-party analytics identifier in localStorage, sessionStorage or IndexedDB. That is a meaningful minimisation safeguard, but it is not by itself a definitive PECR conclusion: the statutory test is broad and the treatment of transient client-side memory/SDK access must be checked against the ICO's current definition of storage and access technologies. Do not claim PECR clearance until deployed browser behaviour and each SDK version have been inspected and the controller has recorded whether any client-side operation falls within Regulation 6. If it does, a valid exception or consent is required. Any cookie, local storage, IndexedDB, device fingerprint or other terminal-equipment access introduced for analytics requires a fresh PECR assessment.

The ICO finalised its updated storage/access guidance on 29 April 2026. Its statistical-purposes exception is narrow: it requires an ISS provider, an exclusive statistical service-improvement purpose, aggregate statistical output that is not personal data, no use for decisions about individuals, prompt aggregation and deletion of individual-level inputs when no longer needed, clear information, and a simple and free means to object. It does not cover tracking individual visitors, retaining individual-level browsing histories, or measuring whether a person viewed/clicked an advertisement for ad-performance purposes. Do not rely on this exception for account-linked analytics or sponsor ad view/click measurement. See [ICO storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/) and [the statistical-purposes exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

### 13.3 Verified provider and retention facts

- Supabase project region is eu-north-1 (Stockholm). This locates the primary Postgres/Auth/Storage services; it does not prove that backups, logs, support access or subprocessors remain in that region.
- The connected Supabase project is on the Free plan. Current published plan information states API/database log retention is one day and Auth audit-log access is 24 hours; automatic database backups and point-in-time recovery are not included on Free. Supabase's DPA is available, but acceptance by this project/controller has not been verified. Review the [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [GDPR guide](https://supabase.com/docs/guides/security/gdpr-compliance), and [plan comparison](https://supabase.com/pricing).
- The connected Vercel team is on Hobby. The current Vercel Terms restrict Hobby to personal/non-commercial use. Vercel's Fair Use Guidelines say commercial usage, including advertising, requires Pro or Enterprise. The Vercel DPA states it applies to Pro and Enterprise customers, not Hobby. The Hobby plan includes one month of Web Analytics history; Vercel's documented request-derived visitor hash is discarded after 24 hours and Hobby runtime logs are retained for one hour. The 19 October 2026 Terms also permit Vercel to use Hobby-plan customer content for model training and share it with third parties for model development/improvement. These are material contractual issues for a public service intended to sell sponsorships. Do not serve commercial sponsor placements on Hobby; keep sponsorship disabled until the project is moved to a permitted plan or a suitable alternative host. See [Vercel Terms](https://vercel.com/legal/terms), [Hobby Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines), and [Vercel DPA](https://vercel.com/legal/dpa).
- Vercel's current deployment on main is READY, but the logo-free PR branch is not deployed. The temporary sponsor-logo compatibility bridge is therefore still required by the currently deployed client and must not be removed from the live database yet.

### 13.4 Provider actions and release gates

1. Confirm and record acceptance of the Supabase DPA; inspect the subprocessor list, transfer impact assessment and all transfer mechanisms. The primary region being Stockholm is not a complete transfer analysis.
2. Confirm the Vercel plan/contract before any commercial sponsor delivery. On the connected Hobby plan, commercial advertising is not permitted and the Vercel DPA is not available. If remaining on Hobby, keep the service non-commercial and do not activate sponsor ads; otherwise move to Pro/Enterprise or migrate to a host with suitable terms and a processor agreement.
3. Review Supabase Auth audit-log storage, database/API logs, function logs and Vercel runtime/build logs. Supabase Free API/database logs are retained for one day and Auth audit-log access for 24 hours; Vercel Hobby runtime logs are retained for one hour, Web Analytics history is one month, and its request-derived visitor hash is discarded after 24 hours. These short windows are not a substitute for an incident-response retention policy.
4. Record that Supabase Free has no automatic backups or PITR; establish a tested, encrypted backup/export and restore process before relying on this as production storage.
5. Resolve the Article 6/Article 9 decision for account-linked operational analytics and any topic-linked sponsor records before treating this DPIA as approved.
6. Verify deployed network traffic and device storage behaviour on web and native builds, including all Vercel SDK requests and browser storage APIs.
7. Keep the sponsor-logo compatibility bridge until the logo-free application is deployed and verified; then run the existing docs/sponsor-logo-removal.sql and confirm the old RPC signature and logo payload are absent.

**Status:** technical review updated; controller legal approval, provider-contract acceptance, hosted MFA cleanup, production deployment and post-deployment bridge removal remain outstanding.
