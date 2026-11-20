# CathoScroll provider, retention and PECR review

**Reviewed:** 20 November 2026  
**Status:** Technical review completed; controller/contract actions remain open.  
**Project:** Supabase CathoScroll, region eu-north-1 (Stockholm); Vercel team joshuaargent, Hobby plan.

## Executive findings

1. Supabase's primary project region is Stockholm. The Free plan provides one day of API/database log retention and 24-hour Auth audit-log access. It does not include automatic database backups or point-in-time recovery. Supabase offers a DPA, but the controller's acceptance of it has not been verified.
2. Vercel's connected team is on Hobby. Vercel's current Terms restrict Hobby to personal/non-commercial use; its Fair Use Guidelines say commercial advertising requires Pro or Enterprise. The Vercel DPA applies to Pro and Enterprise, not Hobby. The 19 October 2026 Hobby Terms also permit use of Hobby-plan customer content for model training and sharing with third parties for model development/improvement.
3. No paid sponsor campaigns are currently active. The owner intends to move to an appropriate commercial hosting plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service. Continue the separate review of Vercel's processor terms, DPA, subprocessors and international-transfer safeguards.
4. The website holds signed-out topic/comment retry batches in memory only. Native apps now persist a bounded, seven-day queue of anonymous topic/comment event payloads in app-private SQLite so it can survive app termination. The schema contains event UUIDs and public topic/comment IDs only, with no account, visitor or session identifier. The global consent manager provides default-off Service improvement analytics and Sponsor measurement choices, with Service improvement analytics automatically enabled and locked while personalisation is active. Signed-out daily aggregate statistics run by default independently of those choices and have a simple free objection in Manage choices. Signed-in consent is account-scoped and synchronised when online. Sponsor frequency tokens are created only when Sponsor measurement is enabled.
5. The PECR statistical-purposes exception is not a general permission for account-level tracking or ad measurement. It requires anonymous aggregate statistical output, no individual monitoring/decisions, prompt aggregation/deletion of individual inputs, clear notice and a simple/free objection route. It does not cover individual ad view/click measurement. CathoScroll should not rely on it for account-linked analytics or sponsor performance tracking.
6. **Current consent model:** enabling recommendation personalisation also enables Service improvement analytics. The same disclosed activity signals support service improvement and the user's private recommendations while personalisation is on; the Service improvement analytics control is locked until personalisation is withdrawn. Sponsor measurement remains separate. Topic interactions may reveal or permit inferences about religious or philosophical beliefs; the controller must document the Article 6 basis and any applicable Article 9 condition.

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
- Current production deployment: READY on main at commit `e0da259`; PR #26 has not been deployed. The PR preview is currently blocked by Vercel's daily deployment quota.
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
6. Verify deployed browser/native network requests, SDK storage behaviour, request metadata, CDN/WAF/function logs and retention settings.
7. Keep the temporary sponsor-logo compatibility bridge until the logo-free application is deployed. Then run docs/sponsor-logo-removal.sql and verify the old RPC signature and null logo payload are gone.
8. Disable Supabase TOTP enrolment and verification in hosted Auth settings and remove the existing unverified factor through the Supabase Auth Admin API. Do not delete managed auth schema rows with SQL.

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

The detailed controller draft is in [docs/uk-gdpr-analytics-assessment.md](./uk-gdpr-analytics-assessment.md). It separates account-linked service analytics, signed-out aggregate topic/comment statistics, sponsor measurement, sponsor delivery accounting, Vercel telemetry and recommendation personalisation. It recommends explicit disclosure and consent for account-linked topic/comment events, with personalisation automatically enabling and locking Service improvement analytics while active; when personalisation is off, that analytics choice is independently optional. Sponsor measurement remains a separate choice.

For visitors who decline sponsor measurement, the proposed least-intrusive fallback is a server-side campaign/day served-placement aggregate only. Do not create client viewability/click events, session tokens, hashed session-frequency rows or per-person frequency records for those visitors. Campaign-wide caps and pacing remain available. This preserves delivery accounting without claiming unique reach, viewability, clicks or CTR for opted-out visitors.

The assessment does not approve PECR compliance. The controller must still document whether the signed-out aggregate topic/comment pipeline and native app-private SQLite outbox meet the statutory statistical-purposes exception or require prior consent. Verify the actual deployed browser/native behaviour and all provider logs before sign-off.

## Consent implementation status (consolidated PR #25)

The central optional analytics consent manager and matching API/client gates were merged in PR #25 and deployed to production in commit `e0da259` on 20 November 2026. The three consent and lock-order migrations are recorded as applied in the production database. Service improvement analytics and Sponsor measurement are optional choices; personalisation also enables and locks Service improvement analytics. Signed-in choices are account-scoped and synchronised through a private consent ledger. Signed-out aggregate topic/comment statistics are on by default with a separate device-local objection preference and no persistent visitor identifier. Vercel Web Analytics and Speed Insights are gated by Service improvement analytics.

When Sponsor measurement is declined, sponsor cards remain eligible for delivery; campaign/day served totals continue for delivery and pacing; no visitor/session token or hash is created; no per-user/per-session frequency row or sponsor served-event receipt is written; and no client viewability/click event is collected. The database now accepts null session IDs/tokens for this path. The server-side campaign/day aggregate fallback is deployed. The final client-side guard that skips session-token creation and viewability observation when consent is off is included in PR #33; browser/native end-to-end verification remains outstanding.

The initial consent migration was executed transactionally against the existing production schema and rolled back before permanent application, followed by rolled-back consent/sponsor-selector smoke tests. No separately billed disposable Supabase branch was created, so a separate clean-install PostgreSQL run remains outstanding. GitHub CI validates the SQL copies and application tests. The consent UI and client-side enforcement are live in production. Browser/native end-to-end verification and a separate clean-install PostgreSQL test remain outstanding; controller/legal approval is still required.
