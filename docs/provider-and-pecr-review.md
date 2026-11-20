# CathoScroll provider, retention and PECR review

**Reviewed:** 20 November 2026  
**Status:** Technical review completed; controller/contract actions remain open.  
**Project:** Supabase CathoScroll, region eu-north-1 (Stockholm); Vercel team joshuaargent, Hobby plan.

## Executive findings

1. Supabase's primary project region is Stockholm. The Free plan provides one day of API/database log retention and 24-hour Auth audit-log access. It does not include automatic database backups or point-in-time recovery. Supabase offers a DPA, but the controller's acceptance of it has not been verified.
2. Vercel's connected team is on Hobby. Vercel's current Terms restrict Hobby to personal/non-commercial use; its Fair Use Guidelines say commercial advertising requires Pro or Enterprise. The Vercel DPA applies to Pro and Enterprise, not Hobby. The 19 October 2026 Hobby Terms also permit use of Hobby-plan customer content for model training and sharing with third parties for model development/improvement.
3. CathoScroll is intended to sell sponsorships. Do not activate commercial sponsor advertising while hosted on Vercel Hobby. Either keep the deployment strictly non-commercial and sponsor delivery disabled, upgrade to a plan with appropriate terms/DPA, or migrate to a host whose commercial-use terms and processor agreement fit the service.
4. The current source holds signed-out analytics retry batches and sponsor frequency tokens in memory only. It does not intentionally persist these analytics identifiers in cookies, localStorage, sessionStorage or IndexedDB. Deployed web/native storage and SDK behaviour still require manual verification.
5. The PECR statistical-purposes exception is not a general permission for account-level tracking or ad measurement. It requires anonymous aggregate statistical output, no individual monitoring/decisions, prompt aggregation/deletion of individual inputs, clear notice and a simple/free objection route. It does not cover individual ad view/click measurement. CathoScroll should not rely on it for account-linked analytics or sponsor performance tracking.
6. Account-linked topic/comment analytics remain a separate UK GDPR Article 6/Article 9 question. Recommendation consent does not cover unrelated operational analytics.

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
- Published Hobby runtime log retention: one hour.
- Vercel Web Analytics documentation says it does not use third-party cookies and derives a request hash discarded after 24 hours.
- Vercel DPA (last updated 17 March 2026) applies to Pro and Enterprise customers, not Hobby.
- Vercel Terms (19 October 2026) restrict Hobby to personal/non-commercial use and permit model training/use of customer content on Hobby. The fair-use guidance expressly treats advertising as commercial usage.

## PECR source review

### First-party CathoScroll analytics

- Signed-out topic/comment events are held in a bounded module-memory queue. They are retried while the page/app process is alive and are discarded when it ends.
- The signed-out sponsor session token is generated and held in memory only. Only a SHA-256 hash is stored server-side for frequency control.
- No analytics queue or sponsor token is written to browser localStorage, sessionStorage, IndexedDB or native persistent storage.
- Vercel Web Analytics and Speed Insights use beforeSend handlers to replace sensitive topic/category/search routes with generic labels and strip query strings/fragments.
- The code review is not a substitute for deployed browser inspection. Verify that no SDK or future change writes/accesses terminal storage for analytics.

### Statistical-purposes exception

The ICO's final guidance dated 29 April 2026 allows a narrow statistical-purposes exception for an ISS provider's exclusive service-improvement statistics, where the result is anonymous aggregate data, individual-level inputs are not retained longer than needed, individuals are clearly informed and have a simple/free objection method. It is not available for identifying/tracking individual visitors, retaining browsing histories, profiling individuals/groups, or measuring individual advertising views/clicks. CathoScroll must not rely on it for account-linked event streams or sponsor ad-performance metrics.

The current code's memory-only approach reduces the PECR device-storage risk. The controller should document whether any actual deployed SDK accesses terminal equipment, and if so, which exception applies. Do not assume that "no cookies" alone resolves all PECR or UK GDPR obligations.

## UK GDPR analytics position

- Recommendation personalisation has its own explicit opt-in and withdrawal controls. This consent is purpose-specific.
- Signed-in topic-feed and Top Comments raw events remain linked to an account for up to 180 days, with a restricted viewer bridge. Their topic/comment identifiers and surrounding context may reveal or permit inferences about religious/philosophical beliefs. ICO guidance distinguishes mere theoretical inferability from processing that intentionally draws or uses a belief inference or treats someone differently because of it; the controller must assess the actual data and purposes rather than assume either that Article 9 always applies or that it never applies.
- Article 6(1)(f) legitimate interests is a possible basis for proportionate internal service measurement, but the controller must complete and approve a purpose/necessity/balancing test. The necessity test must compare account-linked metrics with less intrusive anonymous aggregates.
- If the account-linked records constitute special-category data, a separate Article 9 condition is required. The existing recommendation checkbox does not provide consent for operational analytics. The practical routes are a separate optional explicit-analytics consent with ingestion gating, or redesigning operational analytics to aggregate-only/no-account linkage. Do not claim that legitimate interests alone resolves Article 9.
- Signed-out daily aggregates do not include visitor/session/account identifiers, but small topic/day cells and surrounding request logs still require context-based identifiability review and suppression.

## Outstanding controller and operational actions

1. Accept and retain the Supabase DPA; review the current subprocessor list, data residency details, transfer impact assessment and transfer mechanism.
2. Resolve the Vercel Hobby commercial-use issue before any paid sponsor campaign or public advertising. If remaining on Hobby, keep sponsor ads disabled; otherwise upgrade or migrate.
3. Confirm Vercel's and Supabase's contractual processor/controller roles for each data stream and record the applicable DPAs.
4. Set a backup/export policy for Supabase Free, store encrypted backups outside the project, and test a restore. The provider's Free plan does not supply automatic backups/PITR.
5. Record a purpose-specific Article 6 basis for each analytics stream and approve a legitimate-interests assessment where Article 6(1)(f) is selected.
6. Decide whether account-linked topic/comment and topic-linked sponsor events constitute special-category processing. If so, add a separate optional explicit consent and enforce it server-side, or remove account linkage from operational analytics. Recommendation consent must remain separate.
7. Verify deployed browser/native network requests, SDK storage behaviour, request metadata, CDN/WAF/function logs and retention settings.
8. Keep the temporary sponsor-logo compatibility bridge until the logo-free application is deployed. Then run docs/sponsor-logo-removal.sql and verify the old RPC signature and null logo payload are gone.
9. Disable Supabase TOTP enrolment and verification in hosted Auth settings and remove the existing unverified factor through the Supabase Auth Admin API. Do not delete managed auth schema rows with SQL.

## Sources

- [ICO: Guidance on storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/)
- [ICO: Statistical-purposes exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)
- [ICO: Special-category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/)
- [Supabase: GDPR compliance](https://supabase.com/docs/guides/security/gdpr-compliance)
- [Supabase: Pricing and plan comparison](https://supabase.com/pricing)
- [Supabase: Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [Vercel: Terms of Service](https://vercel.com/legal/terms)
- [Vercel: Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel: Data Processing Addendum](https://vercel.com/legal/dpa)
- [Vercel: Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy)
