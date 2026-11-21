# Privacy, legal, and personalisation implementation notes

**Status:** Product controls and first-pass policy wording implemented. This document is an engineering/privacy record, not legal advice or a completed Data Protection Impact Assessment (DPIA).

## Canonical public policies

The website and native app render the same policy components:

- `/privacy` — Privacy Policy.
- `/terms` — Terms of Service.
- `/cookies` — Cookie Policy.

The policy pages are shared React components imported by the native app. Update the source component once; do not create a second native-only policy copy.

The current commercial model is deliberately simple:

- Individual users do not pay for learning, account, or community features.
- There are no user premium memberships, paid learning subscriptions, or paid content tiers.
- The only paid offering is sponsorship bought by businesses and organisations.
- Sponsor invoices are reconciled against direct bank transfers outside the app. CathoScroll does not process user card payments or use Stripe.
- Sponsored placements are visibly labelled and kept separate from organic topic ranking.
- Sponsor representatives receive aggregate campaign reporting, not user identities, reading histories, or personalisation profiles.

## Personalisation data map

### Purpose and scope

Optional personalisation improves a signed-in user's own educational topic recommendations. It is not an advertising product, a religious-affiliation classifier, or a user eligibility/credit/employment decision system.

CathoScroll's subject matter includes Catholic theology and other religious topics. Reading and interaction patterns may therefore reveal or permit inferences about religious or philosophical beliefs. The optional profile stores content-interest scores for recommendation ordering only.

### Data involved

| Data | Source | Use | Consent state |
|---|---|---|---|
| Impressions, active duration, swipe depth, skips, return visits, Top Comments exposure | Operational analytics tables | Used for service measurement and, only while personalisation is enabled, the account's private recommendation profile. | Service improvement analytics is enabled by the explicit personalisation opt-in and locked on until personalisation is withdrawn |
| Progress/completions, bookmarks, topic likes, comments, comment likes, replies | Existing account activity | Explicit topic-interest evidence | Read for recommendation weighting only when separate personalisation consent is enabled |
| Selected categories | Account settings | Strong user-declared interest signal | Stored only while enabled |
| Derived topic/category scores | Private profile tables | Rank the user's own recommendations | Created/refreshed only while enabled |
| Consent version and timestamps | Signup trigger / account settings RPC | Demonstrate opt-in and withdrawal | Stored as a private audit record |

The profile is not displayed on public profiles, is not provided to sponsors, and is not used for user-level sponsor targeting. Sponsors may choose contextual category or topic placement criteria for a campaign; those criteria are not derived from a user's private personalisation profile or inferred beliefs. No raw comment text is included in the profile. The system does not intentionally infer a user's religious affiliation or make a statement about their beliefs.

### Consent collection and withdrawal

- Consent is off by default and is not required to create or use an account.
- Signup uses a separate, unticked checkbox with an express statement of consent and a link to the Privacy Policy.
- The same shared signup presentation is used on web and native.
- When a new Auth user is inserted with the affirmative signup choice, the private `catho_private.capture_signup_personalization_consent()` trigger records the versioned consent row. A later edit to user metadata does not re-enable consent.
- Existing users can opt in or withdraw in Account settings. The detailed route is `/account/personalization`.
- The shared AccountPageView and PersonalizationSettingsPage are used by web and native; platform-specific authentication/session storage remains in the web/native adapters.
- Withdrawal records the choice, deletes derived topic scores and explicit category choices, and prevents further account-history recommendation weighting.
- Existing cursors are neutralised on the next recommendation RPC call after withdrawal; category weights become equal and completed-topic suppression is disabled. A new sign-in or page reload is not required for this server-side check to take effect.
- The recommendation profile reads eligible operational reading events only while both personalisation and Service improvement analytics are enabled. The personalisation opt-in expressly enables Service improvement analytics; the analytics choice is locked until personalisation is withdrawn. Personalisation withdrawal deletes the derived profile and makes Service improvement analytics independently manageable. Historical raw analytics remain under their stated retention period.

Consent version recorded by the updated signup trigger and Account RPC: `2026-11-20-v4`. Existing v3 grants are withdrawn and must be renewed.

### Recommendation behaviour

All account-history recommendation weighting is behind explicit personalisation consent. The profile combines account actions with feed and Top Comments reading signals recorded after consent. This change also requires Service improvement analytics consent: personalisation enables that choice and locks it until personalisation is withdrawn. Sponsor measurement is never used for recommendations.

When consent is disabled:

- The recommendation RPC does not read or aggregate account-history preference signals.
- Every category has a neutral baseline weight.
- Completed-topic history is not used to suppress topics.
- The normal catalogue ordering, pagination, diversity and safety rules remain in place.

When consent is enabled, the bounded scoring model uses explicit account actions and reading signals recorded after consent, with a maximum 180-day evidence window. It maintains 14-day and 90-day decay horizons and refreshes at most every five minutes. Service improvement analytics is enabled with personalisation and cannot be disabled until personalisation is withdrawn. Sponsor delivery and Sponsor measurement signals are never recommendation inputs.

## Analytics and retention

- Raw topic feed, community-card, and sponsor-campaign analytics events, together with the user/day viewer bridge used for unique-viewer reporting, are retained for up to 180 days.
- Daily totals that do not contain user or session identifiers are retained longer.
- Behavioural topic-interest evidence is bounded to 90 days.
- Explicit account-interaction evidence (including likes, bookmarks, progress and comment engagement) is bounded to 180 days.
- Explicit category selections and derived profile rows are deleted on personalisation withdrawal.
- Sponsor campaign reporting is maintained separately from organic topic and comment recommendation signals. Sponsor frequency-cap rows for completed or rejected campaigns are pruned after the campaign has ended and the applicable 180-day cutoff has passed.
- Sponsor invoice/payment ledger retention needs a documented accounting retention period, confirmed with the operator's accountant before sponsor volume increases.

Do not describe aggregate analytics as a unique count of all visitors where the relevant pipeline only measures authenticated users.

## Public policy alignment

The public Privacy Policy distinguishes account-linked service analytics, signed-out daily entity aggregates, recommendation personalisation and sponsor measurement. Signed-out topic/comment aggregates contain no account ID, raw session ID or persistent visitor ID; event UUID receipts are retained for 30 days. Website retry batches remain in page memory; Android and Electron persist signed-in topic/comment/sponsor retry batches in the encrypted private activity database (2,000 per stream, seven-day expiry, acknowledgement deletion and account-switch cleanup) and signed-out topic/comment events in a separate app-private SQLite outbox with a proposed objection control pending product/controller approval. The PR #40 target removes signed-out sponsor session tokens, event receipts and per-visitor frequency rows; signed-out delivery is campaign/day served totals only. Opted-in signed-in sponsor measurement uses account/session-linked events; native pending sponsor payloads are stored in the encrypted private activity database for up to seven days, while website retry batches remain in memory. Campaign-level aggregates are used for sponsor reporting. Recommendation activity is collected only with personalisation and Service improvement analytics consent; Sponsor measurement remains separate.

The Terms and Cookie Policy state that individual learning, account and community features are free and that business/organisation sponsorship is the only paid offering. There are no user premium tiers, paid learning subscriptions, or in-app card payments. Sponsor invoices are settled through direct bank transfer outside the app.

## Lawful-basis and DPIA work

The current policy wording identifies:
- Article 6(1)(a) UK GDPR consent for optional personalisation and its linked Service improvement analytics; and
- A separate Article 6 basis for any Service improvement analytics collected when personalisation is not enabled; and
- Article 9(2)(a) explicit consent where personalisation, account-linked topic/comment analytics, or topic-linked sponsor measurement reveals special-category religious or philosophical belief data.

The sponsor-measurement consent statement discloses that anonymous event attribution includes the topic placement where a sponsor appeared. The controller must confirm whether that context meets the Article 9 revealing test; if it does not approve the explicit-consent condition, topic-level attribution must be removed before sponsor measurement is enabled.

The signup and account statements expressly identify topic-reading activity and selected interests, explain that these may reveal religious or philosophical beliefs, and state the personalisation purpose. The checkbox is separate from acceptance of the Terms and is unticked by default. The user can withdraw from Account settings. This follows the ICO's guidance that special-category processing needs both an Article 6 lawful basis and an Article 9 condition, and that explicit consent should be specific, affirmative, clear, identify the nature of the sensitive data, separate, and withdrawable: [ICO — Special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/) and [ICO — Explicit consent](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/).

The consent request is separate, optional, affirmative, specific, and withdrawable. The account controls provide withdrawal without requiring a support request.

**Outstanding before broad production rollout:**

1. Complete and approve a documented DPIA. Because the processing may infer special-category beliefs through profiling, assess whether the processing is likely to be high risk, document necessity/proportionality, risks to users, safeguards, residual risk, and the decision to proceed.
2. Confirm whether users under 18 may enable personalisation and whether additional age-related safeguards are required. The Terms currently state a minimum age of 13; this does not by itself settle every question about valid explicit consent for minors.
3. Confirm the controller's full legal identity and postal contact address for the Privacy Policy. The current public policy identifies Joshua Argent and the published email address but does not state a postal address.
4. Confirm the actual Supabase and Vercel hosting regions, applicable international-transfer safeguards, current processor agreements, and subprocessors. Do not promise a specific transfer mechanism until verified.
5. Set and document retention periods for sponsor financial records and moderation/security records with appropriate accounting/legal advice.
6. Verify the live production privacy notice matches the exact consent wording and implementation version before enabling the signup checkbox on the production domain.

## Policy change checklist

When personalisation, analytics, sponsorship, or data providers change:

- Update the Privacy Policy, Cookie Policy, and this implementation note together.
- Update the signup and account consent text if the purpose, categories, recipient, or profile use changes.
- Bump the consent version and decide whether existing users must be asked again.
- Update both the fresh-project bootstrap and the versioned upgrade SQL.
- Check RLS, function grants, trigger behaviour, retention jobs, and the recommendation consent gate.
- Run the privacy, signup, recommendation, native/web parity, and migration tests.
- Re-check the public policies on both website and native builds.

## Legal review boundary

The policy text is an engineering draft based on the current implementation and published product decisions. It should be reviewed by a UK data-protection solicitor or qualified privacy professional before being treated as a final legal assessment. The presence of an opt-in checkbox does not, by itself, prove that all UK GDPR, Data Protection Act 2018, PECR, children's privacy, or international-transfer obligations have been satisfied.


## Separate operational-analytics legal assessment

The personalisation opt-in expressly includes Service improvement analytics while personalisation is enabled because eligible reading signals also inform the private recommendation profile. When personalisation is off, Service improvement analytics can be managed independently. Signed-in topic/comment events remain account-linked and raw events plus the user/day viewer bridge are retained for up to 180 days. Android and Electron persist unsent signed-in topic/comment/sponsor events in an encrypted private outbox for up to seven days; the web queues remain memory-only. Signed-out topic/comment events are stored only as daily entity aggregates, with event UUID receipts deleted after 30 days and no anonymous unique-person count. Signed-in sponsor events use their existing authenticated pipeline. Signed-out sponsor delivery records server-side campaign/day served aggregates regardless of the Sponsor measurement choice. Only signed-in account holders who explicitly opt in to Sponsor measurement generate account/session-linked viewability and click events; server-side account frequency records enforce caps. Native apps persist opted-in sponsor payloads, including account ID, event ID, session ID, campaign ID and event type, in the encrypted private outbox for up to seven days; website retry batches remain in memory. Signed-out visitors create no sponsor session token, event receipt, viewability/click event or per-visitor frequency record. These streams support aggregate admin/sponsor reporting and product measurement; they are not inputs to recommendation weighting unless the separate personalisation consent is enabled.

Service improvement analytics supports engagement measurement, reliability and product improvement, and while personalisation is enabled the same eligible reading signals also inform that user's private topic recommendations. This does not create a religious-affiliation label or feed sponsor targeting. The controller must document the applicable Article 6 basis and, where the data reveals beliefs, an Article 9 condition.


## Verified provider regions and transfer dependencies

- Supabase project `lrddjyxnescfozhcxzil` is in AWS `eu-north-1` (Stockholm). Supabase's current data-residency guidance says the primary database, Auth, Storage origin and backups remain in the selected region, but account/billing data, support access, usage telemetry and some subprocessor processing may occur elsewhere, including Singapore and the United States. Supabase's current DPA supplements its Terms of Service, includes SCCs and the UK Addendum, and is not described as Pro-only; verify the accepted terms and account records for this organisation: [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [data residency and transfers FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq).
- The connected Vercel team is currently on Hobby and the project uses region `iad1` (US East). Vercel's DPA is available on Pro/Enterprise and includes the UK IDTA; the controller should review the applicable processor terms, subprocessors and transfer safeguards as part of the provider review. No paid sponsor campaigns are currently active. The owner intends to move to an appropriate commercial plan before accepting paid sponsorship revenue. This is a future commercial-readiness action, not a blocker to the current pre-revenue service: [Vercel pricing](https://vercel.com/pricing), [Vercel DPA](https://vercel.com/legal/dpa).
- The public Privacy Policy now discloses these current locations and transfer possibilities. Re-check regions and provider terms whenever deployment configuration or provider plans change.

## 20 November 2026 — operational analytics and provider review

Production currently reads account-linked topic and Top Comments events for both service measurement and recommendation weighting when personalisation is enabled. This release makes the link explicit in the consent interface and database: personalisation enables Service improvement analytics, the analytics choice cannot be withdrawn until personalisation is turned off, and the profile refresher checks both consent records. Existing v3 opt-ins are withdrawn for renewed consent. Sponsor measurement remains separate. Article 6(1)(f) may be considered for service measurement outside this linked consent path only after a written purpose/necessity/balancing test.

The ICO finalised its updated PECR storage/access guidance on 29 April 2026. Website topic/comment retry queues are held in JavaScript memory only. Android and Electron persist signed-in topic/comment/sponsor events in the encrypted private activity database and anonymous topic/comment events in a separate app-private SQLite outbox. The anonymous queue contains no account, visitor or session identifier. The current branch includes a Cookie Policy/Privacy Policy objection control as a proposed PECR safeguard, but this was not an agreed product decision and remains pending approval. The PR #40 target does not create signed-out sponsor tokens; production still has the older selector until the matching SQL upgrade is applied. The native queue is still storage on terminal equipment and requires a recorded PECR Schedule A1 assessment before release. The statistical-purposes exception is narrow and cannot be used for account-level visitor tracking or measuring individual ad views/clicks; do not rely on it for the account-linked or sponsor event streams.

Provider facts verified on 20 November 2026: Supabase project region eu-north-1 (Stockholm), Free plan; Supabase Free exposes one day of API/database logs and 24 hours of Auth audit-log access and has no automatic database backups/PITR. Supabase offers a DPA, but project acceptance has not been verified. Vercel connected team is Hobby; its DPA applies to Pro/Enterprise, and its published plan terms and data-use provisions remain part of the controller's provider review. No paid sponsor campaigns are currently active. The owner intends to upgrade to an appropriate commercial plan before accepting paid sponsorship revenue; this is a future commercial-readiness action, not a current service blocker.

The active production deployment is still on main, not the logo-free PR branch. Keep the temporary sponsor-logo compatibility bridge in place until the logo-free build is deployed; then apply the existing removal SQL and verify both RPC signatures and payloads.


## Controller draft assessment — 20 November 2026

A purpose-by-purpose UK GDPR assessment is maintained at [docs/uk-gdpr-analytics-assessment.md](./uk-gdpr-analytics-assessment.md). Account-linked topic/comment activity may reveal religious or philosophical beliefs. The personalisation opt-in therefore expressly includes Service improvement analytics while personalisation is active; Sponsor measurement remains a distinct optional choice. The assessment still requires controller approval of the Article 6 basis and any applicable Article 9 condition.

For sponsor-measurement opt-outs, the proposed fallback is campaign/day served-placement aggregates only, without client viewability/click events, visitor/session tokens, or per-person frequency records. Campaign-wide pacing and caps remain. Account access, account synchronisation, bookmarks, likes, progress, notes and general feed ranking remain unaffected by optional analytics choices.

**Status:** PR #25 was merged and its application code deployed to production in commit `e0da259` on 20 November 2026. The three consent migrations are recorded as applied in production. Controller approval of Article 6 and Article 9 positions, PECR Regulation 6 treatment, DPIA residual risk, children/age safeguards, provider contracts and international transfers remains outstanding. The deployed technical controls do not constitute legal clearance.

## Linked personalisation and Service improvement consent; separate Sponsor measurement

The account consent model exposes separate optional Service improvement analytics and Sponsor measurement purposes, with personalisation linking to Service improvement analytics:

- **Service improvement analytics:** optional account-linked topic and Top Comments engagement plus Vercel Web Analytics/Speed Insights. The notice expressly explains that engagement with Catholic content may reveal or permit inferences about religious or philosophical beliefs. This choice is enabled and locked while personalisation is active; otherwise it is off by default. Signed-out daily aggregates are a separate proposed statistical stream, currently intended to run by default under the PECR statistical-purposes exception. The objection control is provisional and requires product/controller approval before release.
- **Sponsor measurement:** signed-in account-linked sponsor viewability, clicks and account-level frequency. Event attribution may include the topic placement where the sponsor appeared, which may reveal or permit inferences about religious/philosophical interests. The separate control expressly identifies this context and requires explicit consent under Article 9(2)(a) where the revealing test is met, alongside an Article 6 basis. This is separate from sponsor delivery. Declining it does not remove sponsor cards or stop campaign/day served totals. Signed-out visitors receive campaign/day served totals only.

Consent is collected through separate unticked choices at signup and inline Account settings; there is no first-visit popup. Service improvement analytics and Sponsor measurement remain separate controls. Personalisation automatically enables and locks Service improvement analytics while personalisation is enabled; once personalisation is off, it can be changed independently. Sponsor measurement is always optional. The current branch includes a direct free objection control for signed-out aggregate topic/comment statistics on the Privacy and Cookie Policy pages; this was introduced as a proposed PECR safeguard and remains pending product/controller approval. Essential operation, sign-in, account synchronisation, bookmarks, likes, progress, notes and general feed ranking are not optional analytics.

Signed-in consent is stored in catho_private.user_analytics_consents, with a private history table and server-side gates on signed-in analytics ingestion. The proposed signed-out aggregate objection preference is device-local and separate from account consent; it is a provisional branch implementation, not an approved product decision. The aggregate event pipeline does not add a visitor/session identifier. On withdrawal, local collection stops immediately and pending purpose-specific native/web queues are cleared. Signed-in changes retry server synchronisation when connectivity returns.

When Sponsor measurement is declined, sponsor selection receives a null session token/ID. The database still increments campaign/day served totals but does not write anonymous session events, signed-in served-session events, or per-session/per-user frequency rows. The viewability/click event endpoints are gated. Sponsor delivery and campaign-wide caps continue.

**Deployment status:** production is currently on `main` commit `e0da259` (20 November 2026). PR #40 is still open and is not deployed. The live database remains on the older `2026-11-19-v3` personalisation model, has one enabled v3 grant and has no account-level analytics consent rows. The PR #40 SQL upgrade changes the model to `activity-signals-v4`, revokes old v3 grants so users must explicitly re-consent, and removes signed-out sponsor session-token/event measurement. The latest preview is not yet verified against the latest branch head. The SQL upgrade and matching app release must be coordinated; browser/native end-to-end verification and controller/legal approval remain outstanding.
