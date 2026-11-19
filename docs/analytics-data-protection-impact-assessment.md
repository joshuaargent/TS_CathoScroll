# CathoScroll analytics data protection impact assessment

**Assessment date:** 19 November 2026  
**Status:** Provisional internal assessment; not a legal opinion or a declaration of regulatory compliance.  
**Owner/controller:** CathoScroll's operator.  
**Review trigger:** Material changes to analytics purposes, data fields, vendors or retention, and at least annually.

## 1. Processing under review

This assessment covers first-party, account-linked topic-feed and Top Comments analytics for signed-in users; Vercel Web Analytics site-level measurement, including signed-out visitors; Vercel Speed Insights performance measurement; and recommendation personalisation as a separate purpose controlled by the account personalisation setting.

The current product behaviour is intentionally retained. Detailed first-party content analytics are collected for authenticated users; signed-out visitors are not added to that account-linked event pipeline. The existing personalisation checkbox controls whether activity is used to build and apply an individual recommendation-interest profile. It is not blanket consent for every analytics purpose.

## 2. Purposes and necessity

First-party feed and comment analytics help measure whether content and community cards are being seen and used, identify product issues, understand engagement and improve the service. The existing analytics dashboard reports overall, category, topic, comment and sponsor performance. The recommendation system separately uses eligible account activity only where personalisation is enabled.

Vercel Web Analytics provides broader site traffic reporting, including signed-out visits. Vercel Speed Insights measures real-world performance and Core Web Vitals. Neither provider stream is merged into CathoScroll's account-linked topic-event tables.

## 3. Data flows and categories

### 3.1 Signed-in first-party feed analytics

The topic feed records impressions, viewable impressions, active duration, skips, slide depth, completions and return visits. The Top Comments feed records card impressions, viewability, active duration, skips, meaningful-view completions and discussion opens.

Raw events are associated with the authenticated account and include the topic or comment identifier, event/session identifiers, event type, limited event metadata and server receipt time. The private database stores raw event streams and a private daily viewer bridge for up to 180 days. Daily rollups contain aggregate counts without account or session identifiers and are retained longer. Sponsor reporting remains a separate pipeline; sponsors do not receive raw user-level topic or comment activity.

These records are account-linked personal data, not anonymous data. Topic activity on a Catholic learning service may reveal or permit inferences about religious or philosophical beliefs. Treat the information as potentially special-category data and restrict access accordingly.

### 3.2 Signed-out visitors

The first-party topic and comment analytics clients require a signed-in user ID, and both ingestion endpoints independently authenticate the request. Signed-out visitors therefore do not create first-party account-linked topic or comment event records. No first-party persistent visitor ID or signed-out topic history is introduced by this assessment.

Signed-out visits can still contribute to Vercel Web Analytics and Speed Insights. These provider tools are separate from the account-linked first-party event pipeline.

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

- Keep first-party topic and comment ingestion authenticated; reject signed-out requests at the server as well as the client.
- Keep raw analytics tables, viewer bridges and ingestion RPCs private, with administrator-only aggregate reporting and no sponsor access to raw user-level events.
- Retain raw feed and comment analytics for no longer than the current 180-day period, and keep long-term reporting in account-free daily aggregates.
- Keep recommendation personalisation separate from operational analytics in purpose, user-facing wording and account controls.
- Do not use reading activity or inferred religious interests for individual sponsor targeting.
- Remove query strings and fragments from Vercel Web Analytics and Speed Insights events; replace topic, category and search identifiers with generic route labels.
- Keep the strict-origin referrer policy to avoid transmitting full referring-page paths.
- Verify deployed network requests and SDK behaviour after changes or upgrades.
- Review Vercel's DPA, subprocessors, retention, international transfer safeguards and relevant project settings.
- Review hosting, CDN, WAF and function logs, including IP, URL, referrer and user-agent retention; minimise what is configurable and document security logging separately.
- Apply minimum cohort thresholds and suppression where aggregate reports could single out a person, especially for small topics or narrow time windows.
- Keep sponsor campaign analytics separate and do not expose account-level topic/comment histories to sponsors.

## 7. Risk assessment

| Risk | Mitigation | Residual position |
|---|---|---|
| Account-linked topic activity reveals religious/philosophical interests | Restricted private storage, authentication, bounded retention, separate personalisation controls, Article 9 review | Requires controller's documented Article 9 decision |
| Signed-out visitors are incorrectly added to account-linked topic analytics | Client requires user ID; ingestion endpoints independently require authentication | Low for first-party topic/comment event tables |
| Sensitive paths or search terms reach analytics providers | Route-label replacement, query/hash removal and strict-origin referrer policy | Reduced; verify deployed requests and infrastructure logs |
| Small aggregate counts expose an individual | Account-free rollups, cohort thresholds and suppression | Depends on report dimensions and traffic volume |
| Personalisation consent is confused with operational analytics | Distinct purposes and accurate policy wording | Low if notices and implementation remain aligned |
| Provider transfers or infrastructure logs expose excess metadata | DPA/subprocessor review, transfer safeguards, log minimisation | Requires provider and configuration review |

## 8. Rights, retention and transparency

The privacy notice explains the types of first-party events collected, the account link, signed-out exclusion, provider-level site/performance measurement, and the separation from recommendation personalisation. Raw first-party feed/comment events and the viewer bridge are retained for up to 180 days; aggregate daily totals are retained longer where they no longer identify individuals. The controller should continue to assess whether low-volume aggregate rows could identify a person and apply suppression or deletion where needed.

Users can exercise applicable access, rectification, erasure, restriction and objection rights. Where personalisation is based on consent, users can withdraw it through Account settings; that withdrawal stops profile-based recommendation weighting and removes the derived personalisation profile. It does not automatically erase operational analytics records that have a separately documented purpose and lawful basis.

## 9. Conclusion and remaining actions

The implementation retains detailed first-party topic and comment analytics for signed-in users and excludes signed-out visitors from those account-linked event tables. Vercel Web Analytics and Speed Insights remain available for site-level and performance measurement, with route/query minimisation intended to avoid exposing sensitive content identifiers.

The principal remaining legal task is to document the Article 6 basis and, where topic activity is special-category data, the applicable Article 9 condition for operational analytics. The controller should also complete the provider/transfer and infrastructure-log reviews described above. This is a proportionate ongoing compliance review, not a claim that all analytics are anonymous or that CathoScroll has been certified as legally compliant.

## 10. Sponsor analytics

Sponsor campaign delivery, viewability, click analytics and frequency controls are a separate pipeline. This assessment does not certify their lawful basis or retention. Continue to prevent sponsors from accessing raw user-level events or using individual religious/topic interests for targeting. Review campaign placement and frequency data separately to ensure it is not combined with sensitive reading histories.

## 11. Controller action list

1. Record an Article 6 basis for each analytics purpose and complete a legitimate-interests assessment where Article 6(1)(f) is selected.
2. Obtain specialist advice on whether operational topic/comment analytics process special-category data and record the applicable Article 9 condition where required.
3. Review Vercel's DPA, subprocessors, transfer safeguards, retention and project settings.
4. Verify deployed Web Analytics and Speed Insights network events, route redaction and SDK versions.
5. Review CDN, WAF, hosting and function logs, including IP, URL, referrer and user-agent retention.
6. Confirm aggregate dashboard suppression for low-volume data and keep sponsor access aggregate-only.
7. Revisit this assessment after material changes and at least annually.

**Approval record:** This is a provisional internal assessment. The controller should record the reviewer, date, selected lawful bases, Article 9 condition where applicable, provider/transfer checks and any accepted residual risks before treating the review as complete.
