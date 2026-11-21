# CathoScroll — Record of Processing Activities (ROPA)

**Controller:** Joshua Argent, trading as CathoScroll (sole trader, United Kingdom)  
**Controller contact:** argentjackjoshua@gmail.com  
**Controller correspondence address:** To be confirmed before approval; use the business/alternative address selected for the ICO public register, if registration is required.  
**Last reviewed:** 21 November 2026  
**Status:** Working controller record — confirm every marked item against the live service and provider accounts before approval.

This record is maintained as an Article 30 UK GDPR processing inventory. It is a working operational record, not legal advice or a certification that every processing activity is lawful.

## 1. Controller and processing responsibility

Joshua Argent, trading as CathoScroll, determines the purposes and means of processing personal data for the CathoScroll website and Android/Electron applications.

CathoScroll's privacy contact is [argentjackjoshua@gmail.com](mailto:argentjackjoshua@gmail.com). The public Privacy Policy identifies the controller and provides the same contact address.

## 2. Data subjects

- Registered CathoScroll account holders.
- People who create comments, replies or other public contributions.
- Visitors who interact with the website or native applications.
- Sponsor organisation representatives who submit or administer campaigns.
- People who contact CathoScroll through its contact form or email.

## 3. Processing purposes, data categories and proposed lawful bases

The Article 6 bases below are the intended mapping for controller approval. Where processing reveals or permits inference of religious or philosophical beliefs, a separate Article 9 condition is required. The proposed Article 9 condition for the optional purposes below is explicit consent under Article 9(2)(a).

| Purpose | Personal data categories | Data subjects | Proposed Article 6 basis | Article 9 condition where applicable |
|---|---|---|---|---|
| Create and administer accounts; authenticate users; provide learning and community features | Email, username, display name, profile biography, authentication/session identifiers, account preferences | Account holders | Article 6(1)(b), contract or pre-contract steps | None for ordinary account data; assess any special-category content separately |
| Save learning activity and user-requested features | Bookmarks, progress, streaks, notes, quiz progress/results, learning-path progress, likes, comments and replies | Account holders and contributors | Article 6(1)(b), contract or pre-contract steps | If content or activity is processed as revealing beliefs beyond ordinary service delivery, assess Article 9 separately |
| Service improvement analytics | Signed-in account ID, topic/comment identifiers, event/session IDs, event types, viewability, active duration, skips, completions, opens and bounded measurements | Signed-in users who explicitly opt in | Article 6(1)(a), consent | Article 9(2)(a), explicit consent, where activity reveals or permits inference of religious/philosophical beliefs |
| Sponsor measurement | Signed-in account ID, campaign ID, event/session IDs, event type, server-issued placement receipt, viewable impressions and clicks; frequency derived from opted-in event history | Signed-in users who separately opt in | Article 6(1)(a), separate consent | Article 9(2)(a), explicit consent, where placement context reveals or permits inference of religious/philosophical beliefs |
| Personalisation | Explicit category interests, account actions, eligible post-consent reading signals, derived topic-interest scores and private recommendation profile | Account holders who explicitly opt in | Article 6(1)(a), separate consent | Article 9(2)(a), explicit consent, where interests or the derived profile reveal or permit inference of religious/philosophical beliefs |
| Security, fraud/abuse prevention, account protection and service integrity | IP address, device/browser data, authentication events, security logs, request metadata and abuse reports | Visitors and account holders | Article 6(1)(f), legitimate interests, subject to a documented LIA | Do not rely on legitimate interests for special-category belief data without a valid Article 9 condition |
| Sponsor administration and reconciliation | Business contact details, organisation membership/roles, campaign submissions, agreed amounts, invoice balances, payment dates and bank/payment references | Sponsor representatives | Article 6(1)(b) for requested sponsor services and/or Article 6(1)(f) for account administration; controller to confirm per activity | Normally none; assess any unusual content separately |
| Legal, tax and accounting compliance | Invoice and transaction records, correspondence and records required by law | Sponsor representatives and relevant account holders | Article 6(1)(c), legal obligation | None unless special-category data is included |

**Consent separation:** Service improvement analytics, Sponsor measurement and Personalisation are separate, optional choices. Neither analytics choice is enabled for signed-out visitors. Passive reading signals are used for recommendations only when both Service improvement analytics and Personalisation are enabled. Sponsor measurement is never used for recommendations or individual belief-based sponsor targeting.

## 4. Categories of recipients and processors

| Recipient / provider | Role and data processed | Current verified configuration | Due diligence status |
|---|---|---|---|
| Supabase | Authentication, PostgreSQL database, account data, user content, consent records, analytics events and recommendation profiles | CathoScroll project in AWS `eu-north-1` (Stockholm); organisation plan Free; PostgreSQL 17.11.0.011 | Public DPA dated 1 August 2026 reviewed. Confirm that it is incorporated into the actual account terms and record the current subprocessor list and transfer assessment. |
| Vercel | Website hosting, deployment, server-side functions; Vercel Web Analytics and Speed Insights when Service improvement analytics is enabled | CathoScroll project on Hobby team plan; current production deployment region `iad1` (US East) | **Release blocker:** published Vercel DPA says it applies to Pro and Enterprise customers. Do not assume the Hobby account has an Article 28 DPA. Obtain written confirmation of applicable processor terms or move to a plan with the required DPA before release. |
| Formspree | Contact-form delivery (name, email, subject and message) | Production and Preview Formspree form ID is configured in Vercel; the contact form is active | Formspree's security page states it relies on SCCs as a data processor. Obtain and retain the actual DPA, current subprocessor list, processing locations and retention terms before controller approval. |
| Banks/payment institutions | Direct sponsor bank transfers and payment reconciliation | Direct bank transfer; CathoScroll does not store card credentials | Confirm the controller's bank/payment-provider privacy terms and retention. |

CathoScroll does not provide sponsors with user identities, raw user-level analytics events, personalisation profiles, private notes or individual reading histories.

## 5. International transfers and processing locations

- Supabase's primary database, Auth and Storage region is verified as AWS `eu-north-1` (Stockholm, Sweden). This is not a guarantee that all account, support, telemetry, log or subprocessor processing remains in that region.
- Vercel's current production deployment is verified in `iad1` (US East). Vercel's public DPA describes US primary processing facilities and possible processing by subprocessors in other countries.
- Supabase's published DPA includes EU Standard Contractual Clauses and a UK Addendum. Confirm account incorporation, identify the actual transfer paths and complete/retain the required transfer assessment.
- Vercel's DPA applicability for the current Hobby plan is unresolved and is a release blocker.
- Confirm any international processing by Formspree or other configured integrations before enabling them.

## 6. Retention periods

| Data | Current implementation retention |
|---|---|
| Raw signed-in topic, Top Comments and sponsor analytics events | Up to 180 days, or earlier deletion following withdrawal of the relevant consent |
| Restricted user/day viewer bridge for unique-viewer reporting | Up to 180 days, or earlier deletion following Service improvement withdrawal |
| Recent daily aggregates | Rebuilt without a withdrawing user's events within the raw-event retention window |
| Older daily aggregates | May remain only as non-identifying aggregate totals without user-level event or viewer-bridge records |
| Sponsor placement receipts | Seven days; deleted on Sponsor measurement withdrawal |
| Native pending signed-in analytics outboxes | Encrypted app-private storage; maximum 2,000 events per stream and seven days; delete after acknowledgement, withdrawal or account change |
| Website pending signed-in analytics queues | Memory-only; cleared on withdrawal or page/session termination |
| Derived Personalisation profile and selected category interests | Deleted on Personalisation withdrawal; old v4 grants are invalidated by the v5 upgrade and affected profiles/interests are deleted pending fresh consent |
| Analytics consent records | Retained as needed to administer and demonstrate the user's choice, subject to account deletion and legal requirements |
| Core account, user-generated content and sponsor accounting records | Retention depends on service operation, moderation, account deletion, dispute and statutory requirements; controller to confirm detailed periods |
| Provider security/access logs and request metadata | Provider-specific; obtain current retention periods from provider accounts and contracts |

No anonymous topic/comment analytics, anonymous sponsor engagement, anonymous queues, anonymous event receipts, sponsor delivery counters, served totals or anonymous frequency records are collected or retained.

## 7. Storage and security measures

- Supabase stores the primary database in the verified Stockholm region. Private analytics and personalisation tables are restricted to server-side functions and account-scoped access.
- Row-level security and function-level ownership/permission controls are used for user data. Review database security advisors after applying the approved SQL.
- Android and Electron store pending signed-in analytics only in encrypted app-private storage. Queues are account-scoped, capped and cleared on withdrawal/account change.
- Website retry queues are memory-only.
- Newly granted offline analytics choices do not upload queued events until the server has acknowledged the account consent.
- Native personalisation consent caches are versioned. The current v5 consent transition invalidates old cached grants and personalised pages while preserving pending local denials.
- Anonymous event pipelines and their native persistent outbox have been removed.
- Access to provider accounts and production data should be limited to authorised personnel. Confirm current team membership, MFA, access logs, backup/restore controls and incident response arrangements.

## 8. Data subject rights and consent evidence

Users can request access, rectification, erasure, restriction, objection and portability where applicable, and can withdraw consent through Account settings. Requests can be sent to argentjackjoshua@gmail.com. The controller must maintain evidence of the consent wording/version, timestamp, account, purpose and withdrawal history.

The controller must maintain a procedure to identify and respond to rights requests within statutory time limits, including requests involving Supabase or Vercel.

## 9. DPIA and governance status

- DPIA screening and the working analytics DPIA are maintained in `docs/personalization-dpia-screening.md` and `docs/analytics-data-protection-impact-assessment.md`.
- Controller approval of the DPIA screening and decision on whether a full DPIA is mandatory remain outstanding. A proportionate DPIA is prudent because account-linked content engagement may reveal religious/philosophical beliefs.
- The controller must approve the Article 6 basis and Article 9 condition for each relevant purpose and approve the working [security Legitimate Interests Assessment](security-legitimate-interests-assessment.md) for security/abuse processing.
- Complete the ICO data protection fee self-assessment. Sole traders must pay unless exempt. The ICO public register displays the organisation name and address; decide on an appropriate business/alternative address before registration.
- Verify Supabase and Vercel contractual terms, current subprocessors and transfer safeguards. Vercel's current Hobby plan/DPA mismatch is a release blocker.
- Obtain specialist UK data-protection legal review before release.

## 10. Sources and verification records

- [Supabase Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum) — Version 1, 1 August 2026.
- [Supabase Data Residency and Transfers FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq) — Version 1, 6 October 2026.
- [Supabase Subprocessor List](https://supabase.com/legal/customer-resources/subprocessor-list).
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa) — updated 17 March 2026, effective 31 March 2026.
- [Vercel Subprocessors](https://vercel.com/legal/sub-processors).
- [ICO Data Protection Fee Self-Assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/).

