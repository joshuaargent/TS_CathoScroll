# CathoScroll provider, retention and PECR review

**Reviewed:** 20 November 2026  
**Status:** Technical review completed; controller/contract actions remain open.  
**Project:** Supabase CathoScroll, region eu-north-1 (Stockholm); Vercel team joshuaargent, Hobby plan.

## Executive findings

1. Supabase's primary project region is Stockholm. The Free plan provides one day of API/database log retention and 24-hour Auth audit-log access. It does not include automatic database backups or point-in-time recovery. Supabase offers a DPA, but the controller's acceptance of it has not been verified.
2. Vercel's connected team is on Hobby. Vercel's current Terms restrict Hobby to personal/non-commercial use; its Fair Use Guidelines say commercial advertising requires Pro or Enterprise. The Vercel DPA applies to Pro and Enterprise, not Hobby. The 19 October 2026 Hobby Terms also permit use of Hobby-plan customer content for model training and sharing with third parties for model development/improvement.
3. No paid sponsor campaigns are currently active. The owner intends to move to an appropriate commercial hosting plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service. Continue the separate review of Vercel's processor terms, DPA, subprocessors and international-transfer safeguards.
4. The website holds signed-out topic/comment retry batches in memory only. Native apps now persist a bounded, seven-day queue of anonymous topic/comment event payloads in app-private SQLite so it can survive app termination. The schema contains event UUIDs and public topic/comment IDs only, with no account, visitor or session identifier. A free opt-out control is provided in the Cookie Policy and clears pending local events. Sponsor frequency tokens remain memory-only.
5. The PECR statistical-purposes exception is not a general permission for account-level tracking or ad measurement. It requires anonymous aggregate statistical output, no individual monitoring/decisions, prompt aggregation/deletion of individual inputs, clear notice and a simple/free objection route. It does not cover individual ad view/click measurement. CathoScroll should not rely on it for account-linked analytics or sponsor performance tracking.
6. Account-linked topic/comment analytics are used for internal engagement measurement and service improvement, not belief profiling or individual decisions. Record the applicable Article 6 basis for each operational purpose; recommendation consent remains separate.

## Verified configuration

### Supabase

- Project ref: lrddjyxnescfozhcxzil.
- Primary region: eu-north-1 (Stockholm).
- Current plan: Free (connected account context).
- Published Free-plan log retention: API/database logs one day; Auth audit-log access 24 hours.
- Published Free-plan recovery: no automatic backups and no point-in-time recovery.
- Supabase DPA is available. The connected tools do not expose whether the controller has accepted it.
- The primary database/Auth/Storage region does not, by itself, establish the location of backups, logs, support access or all subprocessors.

### Vercel

- Connected team: joshuaargent.
- Current plan: Hobby.
- Production project: ts_cathoscroll.
- Current production deployment: READY on main; the logo-free PR branch has not been deployed.
- Published Hobby runtime log retention: one hour; the Hobby analytics product includes one month of Web Analytics history.
- Vercel Web Analytics documentation says it does not use third-party cookies and derives a request hash discarded after 24 hours. The Hobby plan currently includes one month of Web Analytics history; that is a product reporting window, not a guarantee that every associated operational log has the same retention.
- Vercel DPA (last updated 17 March 2026) applies to Pro and Enterprise customers, not Hobby.
- Vercel Terms (19 October 2026) restrict Hobby to personal/non-commercial use and permit model training/use of customer content on Hobby. The fair-use guidance expressly treats advertising as commercial usage.

## PECR source review

### First-party CathoScroll analytics

- Website signed-out topic/comment events are held in a bounded module-memory queue. Native events are persisted in a bounded seven-day SQLite outbox; a free opt-out clears pending rows.
- The signed-out sponsor session token is generated and held in memory only. Only a SHA-256 hash is stored server-side for frequency control.
- The web analytics retry queue remains in memory and is not written to browser localStorage, sessionStorage or IndexedDB. Native anonymous topic/comment analytics uses a separate app-private SQLite outbox, limited to 2,000 events and seven days, with a user-facing opt-out that clears pending rows. Sponsor frequency tokens remain memory-only.
- Vercel Web Analytics and Speed Insights use beforeSend handlers to replace sensitive topic/category/search routes with generic labels and strip query strings/fragments.
- The code review is not a substitute for deployed browser inspection. Verify that no SDK or future change writes/accesses terminal storage for analytics.

### Statistical-purposes exception

The ICO's final guidance dated 29 April 2026 allows a narrow statistical-purposes exception for an ISS provider's exclusive service-improvement statistics, where the result is anonymous aggregate data, individual-level inputs are not retained longer than needed, individuals are clearly informed and have a simple/free objection method. It is not available for identifying/tracking individual visitors, retaining browsing histories, profiling individuals/groups, or measuring individual advertising views/clicks. CathoScroll must not rely on it for account-linked event streams or sponsor ad-performance metrics.

The native outbox is app-private SQLite storage on mobile/desktop terminal equipment and must be assessed under PECR Regulation 6; describing it as app-private or anonymous does not remove it from the storage/access rules. The statistical-purposes exception may be relevant because this queue exists solely to upload anonymous service-improvement measurements, does not create visitor tracking or ad measurement, aggregates on the server, and has a simple/free opt-out that clears queued rows. However, the controller must confirm that all Schedule A1 conditions are met, including clear information, a simple and free objection route, aggregation/deletion discipline and no use for individual monitoring or advertising. Do not claim PECR clearance until the controller records that assessment and verifies the deployed native behaviour. The website's memory-only queue and all SDK storage/access behaviour must be assessed separately.

## UK GDPR analytics position

- Recommendation personalisation has its own explicit opt-in and withdrawal controls. This consent is purpose-specific.
- Signed-in topic-feed and Top Comments raw events remain linked to an account for up to 180 days, with a restricted viewer bridge. They record engagement measurements for internal service analytics; the analytics pipeline does not create belief labels/profiles or use events to make individual decisions.
- Article 6(1)(f) legitimate interests is a possible basis for proportionate internal service measurement, but the controller must complete and approve a purpose/necessity/balancing test. The necessity test must compare account-linked metrics with less intrusive anonymous aggregates.
- Record the applicable Article 6 basis for operational analytics and complete a purpose/necessity/balancing assessment where legitimate interests is selected. Keep operational measurement separate from the optional recommendation-personalisation profile.
- Signed-out daily aggregates do not include visitor/session/account identifiers, but small topic/day cells and surrounding request logs still require context-based identifiability review and suppression.

## Outstanding controller and operational actions

1. Accept and retain the Supabase DPA; review the current subprocessor list, data residency details, transfer impact assessment and transfer mechanism.
2. Before accepting paid sponsorship revenue, complete the planned move to an appropriate commercial hosting plan. No hosting-plan change is required for the current pre-revenue service.
3. Confirm Vercel's and Supabase's contractual processor/controller roles for each data stream and record the applicable DPAs.
4. Set a backup/export policy for Supabase Free, store encrypted backups outside the project, and test a restore. The provider's Free plan does not supply automatic backups/PITR.
5. Record a purpose-specific Article 6 basis for each analytics stream and approve a legitimate-interests assessment where Article 6(1)(f) is selected.
7. Verify deployed browser/native network requests, SDK storage behaviour, request metadata, CDN/WAF/function logs and retention settings.
8. Keep the temporary sponsor-logo compatibility bridge until the logo-free application is deployed. Then run docs/sponsor-logo-removal.sql and verify the old RPC signature and null logo payload are gone.
9. Disable Supabase TOTP enrolment and verification in hosted Auth settings and remove the existing unverified factor through the Supabase Auth Admin API. Do not delete managed auth schema rows with SQL.

## Sources

- [ICO: Guidance on storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/)
- [ICO: Statistical-purposes exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)

- [Supabase: GDPR compliance](https://supabase.com/docs/guides/security/gdpr-compliance)
- [Supabase: Pricing and plan comparison](https://supabase.com/pricing)
- [Supabase: Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [Vercel: Terms of Service](https://vercel.com/legal/terms)
- [Vercel: Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel: Data Processing Addendum](https://vercel.com/legal/dpa)
- [Vercel: Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy)


## 20 November 2026 — UK GDPR analytics assessment update

The detailed controller draft is in [docs/uk-gdpr-analytics-assessment.md](./uk-gdpr-analytics-assessment.md). It separates account-linked service analytics, signed-out aggregate topic/comment statistics, sponsor measurement, sponsor delivery accounting, Vercel telemetry and recommendation personalisation. It recommends a separate explicit service-analytics choice for account-linked topic/comment events and a separate sponsor-measurement choice. Recommendation personalisation remains on signup and Account settings only.

For visitors who decline sponsor measurement, the proposed least-intrusive fallback is a server-side campaign/day served-placement aggregate only. Do not create client viewability/click events, session tokens, hashed session-frequency rows or per-person frequency records for those visitors. Campaign-wide caps and pacing remain available. This preserves delivery accounting without claiming unique reach, viewability, clicks or CTR for opted-out visitors.

The assessment does not approve PECR compliance. The controller must still document whether the signed-out aggregate topic/comment pipeline and native app-private SQLite outbox meet the statutory statistical-purposes exception or require prior consent. Verify the actual deployed browser/native behaviour and all provider logs before sign-off.
