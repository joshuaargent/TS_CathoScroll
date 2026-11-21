# Provider, PECR and data-protection review

**Status:** implementation assessment for the CathoScroll controller. This is not a legal opinion or a declaration that provider due diligence is complete.

## Current analytics architecture

CathoScroll does not collect anonymous engagement analytics. The following are not collected for anonymous or non-consenting visitors:

- Topic impressions, viewability, active reading duration, skips or completions.
- Top Comments card impressions, viewability, duration or opens.
- Sponsor viewability, clicks, duration or frequency.
- Sponsor delivery/served counts, campaign/day counters or anonymous reach.
- Anonymous visitor/session tokens, hashes, event receipts, retry queues or aggregate analytics tables.

Sponsor cards remain eligible for delivery regardless of consent. Delivery itself is not counted or stored for analytics, pacing or reporting. Unmeasured delivery does not create a client-side session identifier.

## Signed-in analytics

- **Service improvement analytics:** account-linked topic and Top Comments engagement only while the account holder has explicitly enabled the choice. Topic/comment identifiers and bounded event measurements may reveal or permit inference of religious or philosophical interests.
- **Sponsor measurement:** separate account-linked viewability, click and frequency measurement only while explicitly enabled. Event payloads use account, campaign, event, session and event-type fields. They must not contain topic IDs, category IDs, reading history or recommendation-profile data.
- **Personalisation:** separate account-level recommendation purpose. The derived profile is private and must not be used for sponsor targeting.
- **General feed ranking:** does not use anonymous analytics or sponsor delivery/measurement events.

Website retry queues are memory-only. Android and Electron persist only consented signed-in analytics streams in encrypted app-private storage, capped at 2,000 events per stream and seven days, deleting acknowledged events and clearing the relevant stream on withdrawal or account change. Consented sponsor events include a server-issued placement receipt; the receipt is stored in the encrypted native outbox and expires server-side after seven days. No anonymous native queue exists.

## PECR assessment

Removing anonymous analytics removes the anonymous event pipeline; it does not automatically settle PECR for the remaining signed-in streams. Assess each browser and native storage/access mechanism, including SDK behaviour and any device-side identifiers.

Do not rely on the statistical-purposes exception for sponsor measurement or advertising. Sponsor viewability, click and frequency measurement is treated as advertising measurement and is gated by a separate prior opt-in. Do not assume that an event is outside PECR merely because it is account-linked, first-party, short-lived or held in memory.

Vercel Web Analytics and Speed Insights are gated behind Service improvement analytics in the current implementation. Verify the actual SDK versions, network requests, browser storage/access and route redaction in deployed web builds. Verify native WebView behaviour separately. If any optional analytics storage/access is used, the consent choice must precede it and withdrawal must stop it.

## UK GDPR and special-category risk

CathoScroll is a Catholic theology service. Account-linked reading behaviour and recommendation profiles can reveal or permit inference of religious or philosophical beliefs. Where the processing intentionally reveals, infers or uses those beliefs, the controller must identify both an Article 6 lawful basis and an Article 9 condition. Explicit consent may be appropriate, but it must be specific, informed, freely given, affirmative and easy to withdraw.

Do not use religious beliefs, inferred faith, topic/category history or recommendation profiles to target sponsors. Sponsor measurement is for aggregate campaign reporting and frequency controls only. Sponsors must not receive raw user-level events or reading histories.

## Verified provider-account facts (21 November 2026)

The connected account configuration was inspected read-only:

| Provider | Verified configuration | Legal implication |
|---|---|---|
| Supabase | CathoScroll project; AWS region `eu-north-1` (Stockholm); Free organisation plan; PostgreSQL 17.11.0.011 | The database's primary region is Stockholm. This does not mean all support, account, telemetry, log or subprocessor processing stays in that region. |
| Vercel | `ts_cathoscroll` project; Hobby team plan; current production deployment region `iad1` (US East) | The public Vercel DPA states that it applies to customers on Pro and Enterprise plans. The current Hobby account must not be assumed to have that DPA. This is a release blocker until Vercel confirms an applicable Article 28 processor agreement for the Hobby plan or the account moves to a plan with the required DPA. |

Official provider materials reviewed:

- Supabase [Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum), Version 1 — 1 August 2026. It identifies Supabase Pte. Ltd. as processor, provides for EU SCCs and a UK Addendum, and permits processing by authorised subprocessors. The controller must confirm the applicable agreement is incorporated into the actual account terms and review the current [subprocessor list](https://supabase.com/legal/customer-resources/subprocessor-list).
- Supabase [Data Residency and Transfers FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq), Version 1 — 6 October 2026. It states that the selected region hosts the primary database, Auth and Storage, but account information, support, telemetry, logs and CDN processing may involve other regions.
- Vercel [Data Processing Addendum](https://vercel.com/legal/dpa), updated 17 March 2026, effective 31 March 2026. Its scope states that it applies to Vercel processing for customers on Pro and Enterprise plans and describes US primary processing facilities and international transfers. The current Hobby plan's contractual position remains unverified.
- ICO [data protection fee self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/). The ICO says organisations, including sole traders, that use personal information must pay unless exempt. Complete the official self-assessment; do not assume exemption or a fee tier. The GOV.UK registration page states that the organisation's name and address appear on the public register; if operating from home, it says a PO box or alternative address can be provided instead. Decide what lawful business address to publish before registering.

These checks verify account configuration and public terms only. They do not prove that either provider agreement has been accepted, that a transfer impact assessment has been completed, or that the current subprocessor list has been reviewed and recorded.

## Formspree contact-form integration

The Vercel project has a configured `NEXT_PUBLIC_FORMSPREE_FORM_ID` for both Production and Preview. The contact form is therefore active and sends the submitter's name, email address, subject and message to Formspree. It is not merely an optional integration.

Formspree's [security page](https://formspree.io/security/) states that its services are hosted on AWS in the United States, that it acts as a data processor and that it relies on Standard Contractual Clauses for international transfers. Its public privacy information directs customers to obtain the DPA, subprocessor list, processing locations and retention details through its privacy portal. The controller must obtain and retain the actual DPA and current vendor records, confirm the applicable transfer mechanism and review Formspree's spam-filtering subprocessors. Until this is completed, Formspree's Article 28 and transfer arrangements remain unverified.

## Provider checks still required

The code review does not prove that provider contracts and transfers are compliant. The controller must verify, in the actual accounts and current provider terms:

- Vercel and Supabase processor terms, subprocessors, processing locations and international transfer mechanisms.
- Any other connected provider receiving account, analytics, authentication, security or payment data.
- Article 28 processor terms, appropriate transfer safeguards and the required privacy disclosures.
- Runtime, security and access-log fields and retention, including IP addresses and request metadata.
- Whether Vercel Web Analytics/Speed Insights processing is covered by the selected consent and disclosed accurately.

## Controller governance still required

- Complete and approve a DPIA screening; complete a full DPIA if the processing is likely to result in high risk. A proportionate DPIA is prudent given the religious-content context and account-linked profiling.
- Maintain a record of processing activities, retention schedule, data-subject request procedure and consent evidence.
- Record the Article 6 basis and Article 9 condition for each relevant purpose. If legitimate interests is used for non-special-category operational processing, complete a documented necessity and balancing assessment.
- Confirm the controller's ICO fee-registration position and pay any fee that is due.
- Have a UK data-protection solicitor review the final deployed behaviour, notices, provider arrangements and DPIA before release.

## Retention and withdrawal

Signed-in raw analytics events and the restricted viewer bridge are retained for up to 180 days under the current implementation. Native pending events are capped at 2,000 per stream and seven days, deleted after acknowledgement, and cleared on withdrawal/account change. Consent history is retained as needed to demonstrate the choice. Apply the published account deletion and legal-retention rules consistently.

Withdrawal must take effect locally immediately, stop new collection and uploads, clear the matching pending queue, and synchronise the denial to the server when connectivity returns. Do not silently switch to another lawful basis for the same optional purpose after consent is withdrawn.


On withdrawal, the server removes the account-linked raw event records and placement receipts for the withdrawn purpose and rebuilds recent aggregate tables from the remaining opted-in event ledger. Native pending queues are cleared locally; historical daily aggregates older than the raw-event retention window may remain only as non-identifying totals.
