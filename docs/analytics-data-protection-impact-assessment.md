# CathoScroll analytics data protection impact assessment

**Assessment date:** 19 November 2026  
**Status:** Provisional internal DPIA; not a legal opinion or a declaration of regulatory compliance.  
**Owner/controller:** CathoScroll's operator.  
**Review trigger:** Before enabling new topic-level signed-out analytics, before changing analytics purposes or vendors, and at least annually while the processing continues.

## 1. Processing under review

This assessment covers:

1. First-party, account-linked topic-feed and Top Comments exposure analytics for signed-in users.
2. Vercel Web Analytics site-level measurement, including signed-out visitors.
3. Vercel Speed Insights, which is disabled pending a separate data-field and transfer review.
4. The proposed collection of first-party topic-level analytics from signed-out visitors. This proposal is **not approved** by this assessment.

Recommendation personalisation is a separate purpose and processing activity. The signup personalisation checkbox does not authorise operational analytics, and declining personalisation does not withdraw or grant consent for analytics.

## 2. Purpose and necessity

The purposes are to measure service usage, understand whether feed and community-card features work, diagnose reliability and performance, protect the service, and make product improvements. Analytics is not used to target sponsors with individual reading histories.

Aggregate site-level traffic measurement is sufficient for general visitor counts and broad usage trends. It does not justify collecting a visitor's topic-by-topic reading history. Detailed topic-level event collection should be limited to the minimum needed for a documented purpose and only where both the Article 6 and, if special-category data is processed, Article 9 conditions are satisfied.

## 3. Data flows and data categories

### 3.1 First-party signed-in feed analytics

The current implementation records topic impressions, viewability, active duration, skips, slide depth, completions and return visits. The raw event stream includes the account user ID, topic ID, event ID, session ID, event type, limited event metadata and server receipt time. Raw events and the user/day viewer bridge are retained for up to 180 days. Daily rollups contain no user or session identifiers.

These records are pseudonymous at most while identifiers are retained; they are not anonymous. Topic-level activity on a Catholic learning service may reveal or support inferences about religious or philosophical beliefs. The data must therefore be treated as potentially special-category data until a documented assessment demonstrates otherwise.

### 3.2 Vercel Web Analytics

Vercel's published privacy documentation states that Web Analytics does not use third-party cookies, uses a hash derived from the incoming request to identify a short-lived visitor session, and discards that hash after 24 hours. Vercel states that the hash is not permanently stored and that its analytics data is used for aggregated statistics. Its documented data points may include timestamps, URLs, referrers, filtered query parameters, approximate geolocation, device type, and browser/OS information.

CathoScroll now applies a `beforeSend` hook that normalises every page-view URL to the site's root and removes query strings and fragments. Consequently, topic paths and query values are not intentionally sent as page URLs. This does not control all request metadata processed by Vercel or other infrastructure, and the provider's own documentation, DPA, subprocessor list, retention, and transfer arrangements still require review.

Vercel Web Analytics is provider-level site reporting. It is not CathoScroll's first-party topic-event stream and is not currently integrated into the Admin Analytics topic/event tables.

### 3.3 Signed-out first-party analytics proposal

No first-party signed-out topic-level event stream is enabled. The client and ingestion endpoint require an authenticated account. Do not add a persistent visitor ID, browser fingerprint, localStorage analytics queue, topic/category/comment/sponsor identifier, full URL, referrer, or per-visitor history for signed-out visitors under this assessment.

A future content-blind aggregate counter could record only coarse event totals by day (for example, generic feed opens and generic feed advances), without topic/category identifiers, session IDs, event-level rows, or unique-visitor counts. However, even generic use of a Catholic learning service may carry contextual sensitivity. Such a change is not approved until the remaining legal-basis, PECR, infrastructure logging, and DPIA actions below are completed.

## 4. UK GDPR Article 6 and Article 9 assessment

A lawful basis under Article 6 must be documented for each purpose. Legitimate interests may be considered for proportionate, content-blind service measurement, subject to a written legitimate interests assessment, necessity, balancing, user expectations, and effective objection controls. It must not be assumed to apply automatically.

Where topic-level reading activity reveals or permits inferences about religious or philosophical beliefs, an Article 9 condition is also required. The personalisation consent is purpose-limited and cannot be reused as operational analytics consent. A possible route for optional topic-level analytics is separate, explicit, specific, informed, freely given consent under Article 9(2)(a), together with an Article 6 basis. Other Article 9 conditions should not be asserted without specialist advice and evidence that their requirements are met.

**Unresolved production control:** the current first-party signed-in feed analytics pipeline is account-linked and contains topic IDs. The code and existing privacy notice do not by themselves establish an Article 9 condition. Before treating this stream as approved, the controller must document the Article 6 basis and Article 9 condition. If explicit consent is selected, implement a separate analytics consent, default off, with a withdrawal route and deletion/suppression rules; do not reuse the recommendation checkbox. Until that is completed, this DPIA does not certify the existing topic-level stream as lawful.

## 5. PECR and device storage/access

The Vercel Web Analytics integration is documented by Vercel as not using third-party cookies. CathoScroll's URL-redaction hook does not create browser storage. The proposed signed-out first-party aggregate design must not use localStorage, IndexedDB, cookies, device fingerprinting, or other terminal-equipment storage/access for analytics without first assessing and obtaining any consent required by PECR. Essential authentication and preference storage remains a separate purpose and must not be repurposed as an analytics identifier.

The controller must verify the exact deployed Vercel script/version and any other third-party scripts against current PECR guidance. A provider's description of a product as privacy-friendly or cookieless is not, on its own, a legal exemption.

## 6. Necessity, proportionality and safeguards

- Keep recommendation personalisation separate from operational analytics in code, UI, consent records, database permissions, and documentation.
- Do not send topic IDs, category IDs, comment IDs, sponsor IDs, full URLs, query strings, referrers, or reading histories to Vercel Web Analytics.
- Normalise Vercel page-view URLs to the site root before transmission. Verify this in a deployed network capture after release.
- Keep Vercel Speed Insights disabled until its data fields, route handling, retention, processor terms, and transfer position have been reviewed.
- Keep first-party raw analytics in the private database schema, with no direct client table grants, validated RPC ingestion, strict rate limits, bounded payloads, deduplication, and bounded retention.
- Keep individual analytics unavailable to sponsors and out of sponsor targeting.
- Do not publish small-cell analytics that could single out an individual or reveal sensitive interests. Any future aggregate report should apply minimum cohort thresholds and suppress low-count rows.
- Do not create a signed-out unique-visitor metric unless a separate privacy assessment establishes a proportionate and lawful identifier strategy.
- Verify server, CDN, WAF, function, and provider logs. Minimise URL, IP, referrer and user-agent logging where configurable, and document unavoidable security logging separately from analytics.

## 7. Risk assessment

| Risk | Initial severity | Mitigation | Residual risk |
|---|---|---|---|
| Topic-level activity reveals religious/philosophical beliefs | High | Separate Article 9 assessment; separate explicit analytics consent if required; private storage; 180-day raw retention; no sponsor access | Medium until lawful basis and consent controls are documented |
| Signed-out visitors are profiled through persistent IDs | High | No first-party signed-out event stream, no persistent visitor ID, no browser analytics queue | Low for CathoScroll's own feed-event store; provider request processing remains |
| Sensitive topic paths leak to analytics provider | High | Vercel `beforeSend` rewrites every page URL to root and strips query/hash; no custom topic events | Medium until deployed network capture verifies it and referrer handling is confirmed |
| Small aggregate counts expose an individual | Medium | No per-visitor records; future aggregate reports require minimum cohort thresholds and suppression | Low to medium depending on report dimensions |
| Analytics consent is confused with personalisation consent | High | Separate purposes and separate UI/records; current notice states the distinction | Medium until account-level analytics consent is implemented or another Article 9 condition is evidenced |
| Third-party transfer, retention or subprocessor exposure | Medium | Review Vercel DPA, subprocessors, transfer mechanism, settings and retention | Medium pending documentary review |
| Security logs retain IP or sensitive URL data | Medium | Review and minimise Vercel/CDN/WAF/function logs; fixed analytics URL; access controls and retention | Medium pending provider configuration evidence |

## 8. Data subject rights and retention

The controller must provide a clear route to exercise access, erasure, objection, and withdrawal rights where applicable. Account-linked raw analytics and viewer-bridge records are retained for up to 180 days under the current design; daily aggregate totals are retained longer. The controller must document whether daily topic totals can still identify a person in low-volume cases and apply suppression or deletion where necessary. Vercel's 24-hour visitor-hash statement is the provider's published position and must be rechecked against the current contract and configuration.

## 9. DPIA conclusion and deployment decision

**Signed-out first-party topic-level analytics: not approved.** The current product already has signed-out site-level measurement through Vercel Web Analytics. CathoScroll has therefore not added a second, visitor-level topic-tracking system. The Vercel page URL is now normalised to the site root to reduce the risk of topic-specific path disclosure. Speed Insights is disabled pending its separate review.

**Signed-in first-party topic- and comment-level analytics: paused by default and not certified by this assessment.** Both viewers are gated by `NEXT_PUBLIC_ACCOUNT_LINKED_FEED_ANALYTICS=true`, and both ingestion routes independently fail closed unless `ACCOUNT_LINKED_FEED_ANALYTICS_ENABLED=true`. Both must remain unset until the controller documents the Article 6 basis and applicable Article 9 condition, and implements any required separate explicit consent, withdrawal, and deletion controls. The recommendation personalisation checkbox is not that condition.

The residual risk cannot be marked fully accepted until the controller completes the actions below. If the controller cannot identify an applicable Article 9 condition, the account-linked topic-level stream must remain paused or be redesigned.

## 10. Scope limitation: sponsor campaign analytics

Sponsor campaign delivery, viewability and click analytics are implemented as a separate pipeline. They are not the same as topic/comment feed telemetry, and this assessment does not certify their lawful basis, retention, or possible linkage to sensitive reading context. Review that pipeline separately, including whether campaign IDs or placement context can reveal special-category interests and whether any user-level frequency data is retained. Sponsors must not receive individual reading histories or use them for sensitive-interest targeting.

## 11. Required controller actions before declaring the analytics processing approved

1. Complete and sign a purpose-specific legitimate interests assessment for any processing relying on Article 6(1)(f), or document the selected Article 6 basis.
2. Obtain specialist UK data-protection advice on whether the existing topic-level feed and comment-card telemetry processes special-category data and identify the applicable Article 9 condition.
3. If relying on explicit consent, implement a separate, optional, default-off analytics consent for signed-in users and signed-out visitors; keep it distinct from personalisation; record version/time/purpose; provide withdrawal; and define the effect on existing raw data.
4. Review Vercel's DPA, subprocessor list, international transfer mechanism, data retention, project settings, and any available regional controls.
5. Inspect deployed network requests to confirm URL redaction, no custom content identifiers, and no unexpected third-party analytics scripts. Confirm how referrer information is handled.
6. Review and configure Vercel/CDN/WAF/hosting/function logs, including IP address, user-agent, referrer and URL retention. Record what cannot be disabled and why it is necessary for security.
7. Define minimum cohort thresholds and suppression rules before exposing any topic-level aggregate report.
8. Review the assessment after material product/vendor changes and at least annually.

**Approval record:** Not yet approved. The controller must record the reviewer, date, selected lawful bases, Article 9 condition (if applicable), vendor/transfer checks, and residual-risk acceptance before marking this DPIA complete.
