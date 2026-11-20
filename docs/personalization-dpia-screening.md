# CathoScroll personalisation and analytics DPIA screening

**Status:** Draft engineering screening — not approved, not a completed DPIA, and not legal advice.
**Review date:** 19 November 2026
**Controller:** Joshua Argent, operating CathoScroll.
**Scope:** Web and native account-linked analytics, optional personalisation, recommendation ranking, sponsor reporting.

A UK privacy professional must review and complete this assessment before broad production rollout. The service covers Catholic and religious topics. Reading and interaction data may reveal religious or philosophical beliefs, which are special-category data under UK GDPR where the information reveals those beliefs.

## 1. Processing description

### Optional personalisation

Users may separately opt in at signup or later in Account settings. The checkbox is unticked by default and is not required to use CathoScroll. The recorded consent version is `2026-11-19-v3`.

When enabled, the production system uses only explicit account actions recorded after personalisation consent:
- progress and completed topics;
- bookmarks and topic likes;
- comments written, comment likes and replies written;
- categories explicitly selected by the user;
- derived topic/category interest scores based on those actions.

Operational analytics measurements (impressions, active duration, swipe depth, skips, return visits and Top Comments exposure) are not inputs to the recommendation profile.

**Production verification (20 November 2026):** the live database profile refresher and recommendation RPC have been updated and checked. They no longer read operational feed or Top Comments analytics events. Existing derived profiles were cleared and rebuilt from explicit account actions; the analytics event tables remain for service measurement only.

The profile is private, is not displayed on public profiles, and is not provided to sponsors. It is not used for user-level sponsor targeting. Sponsors may select contextual category/topic placement criteria, but those criteria are not derived from the user's private profile.

Explicit account-action evidence is limited to 180 days, with 14-day and 90-day decay horizons. No operational analytics events are used. Profile refresh is cached for five minutes. Withdrawal deletes derived topic scores and explicit category selections. The recommendation RPC immediately normalises active cursors after withdrawal.

When consent is disabled, the recommendation RPC does not read account-history signal tables, uses neutral category weights, and does not suppress completed topics.

### Operational analytics

Separate operational analytics records authenticated feed, comment-card, and sponsor events for admin reporting, content-performance measurement, reliability, and frequency-cap enforcement. Raw events and user/day viewer bridges are retained for up to 180 days; non-identifying daily aggregates are retained longer.

Operational analytics are **not** covered by the personalisation checkbox and are never used for recommendation weighting. They are collected only under their separate Service improvement analytics choice. These account-linked topic/card events may nevertheless reveal sensitive interests. A separate Article 6/Article 9 assessment is an unresolved launch gate; see section 6.

### Sponsor reporting

Sponsor reporting is maintained separately from organic recommendation signals. Sponsors receive aggregate campaign reporting, not account identities, individual reading histories, raw user-level analytics, or personalisation profiles. Campaigns may use contextual category/topic placement rules.

## 2. Necessity and proportionality questions

The reviewer must document:
- why account-level personalisation is needed instead of contextual or user-selected recommendations alone;
- why each input signal is necessary and whether a less intrusive signal would work;
- whether 90-day behavioural and 180-day explicit-interaction windows are proportionate;
- whether per-topic profile detail can be reduced or coarsened;
- whether user-linked operational analytics can be aggregated or anonymised earlier;
- whether profile refresh caching and event rate limits are sufficient to prevent excessive processing;
- whether users receive a genuine choice without losing access to core learning or community features.

Current safeguards include opt-in consent, neutral recommendations when disabled, withdrawal and profile deletion, bounded evidence windows, private tables, restricted RPCs, sponsor separation, and retention limits.

## 3. People affected

- signed-in adult users who opt in to personalisation;
- signed-in users whose activity appears in operational analytics;
- users who interact with community comments;
- sponsor representatives who access campaign-level reports;
- potentially children aged 13–17, subject to the age/consent review below.

The product's current minimum age is 13. This does not settle whether a particular minor can provide valid explicit consent for special-category processing. The age and capacity approach must be reviewed and documented.

## 4. Risks and current mitigations

| Risk | Current controls | Residual status |
|---|---|---|
| Religious/philosophical interests inferred from reading patterns | Optional opt-in, clear sensitive-data wording, private profile, no sponsor sharing | Medium; validate consent and inference scope |
| Users cannot genuinely refuse personalisation | All individual learning/community features remain free; neutral feed when off | Low, subject to product verification |
| Consent is bundled or preselected | Separate unticked signup checkbox; separate Account control | Low; verify on web and native builds |
| Withdrawal leaves a personalised cursor active | Recommendation RPC re-normalises category weights and completion handling | Low; regression-tested |
| Profile or raw event data exposed to sponsors | Separate sponsor pipeline; aggregate campaign reports only | Low; verify admin/export permissions |
| Excessive retention | 90-day behavioural window, 180-day explicit evidence and raw-event/viewer bridge retention | Medium; verify all scheduled jobs and sponsor records |
| Unauthorised access to profiles or raw events | Private schema, restricted RPCs, RLS, service-role-only admin reports | Medium; complete independent permission review |
| Operational analytics itself reveals special-category interests | 180-day raw retention, access restrictions, not used for ranking without consent | High/unresolved until Article 9 assessment or redesign |
| Processor/international transfer exposure | Supabase and Vercel are identified processors | Medium/unresolved until regions, DPAs, and transfers verified |
| Minors provide invalid consent | Minimum age 13 in Terms | High/unresolved until age/capacity approach reviewed |

## 5. Data lifecycle and safeguards

- Consent record: private, versioned, timestamped; signup trigger records only an affirmative choice.
- Derived profile: private tables; created/refreshed only while consent is enabled.
- Withdrawal: derived topic scores and explicit category selections deleted; active cursor normalised.
- Raw feed/community/sponsor events and user/day viewer bridge: up to 180 days.
- Daily aggregates without user/session identifiers: retained longer.
- Sponsor frequency-cap rows: pruned after campaign completion/rejection and the applicable 180-day cutoff.
- Sponsor invoices and financial records: accounting retention period still needs to be set with the accountant.
- Security: review RLS, function ACLs, service-role access, backups, incident response, and account deletion end-to-end.

## 6. Required decisions before broad production rollout

1. **Operational analytics Article 9 condition:** Determine whether account-linked topic/card events reveal religious or philosophical beliefs in context. The personalisation consent does not cover this stream. If it is special-category processing, identify a valid Article 9 condition; if explicit consent is required, add a separate optional analytics consent or redesign the pipeline to aggregate/anonymise before retaining user-linked event detail.
2. **DPIA completion:** Complete the necessity/proportionality assessment, risk scoring, mitigations, residual-risk decision, and controller approval. Do not treat this screening as approval.
3. **Children:** Decide whether personalisation is available to users aged 13–17 and document capacity/parental considerations.
4. **Controller details:** Add the controller's full legal identity and postal address to the public Privacy Policy.
5. **Processors/transfers:** Supabase is currently in AWS Stockholm (eu-north-1); Vercel functions are currently in US East (iad1). Verify the Vercel plan includes the published DPA, confirm the Supabase DPA and subprocessors, review SCCs/UK IDTA coverage, and re-check deployment regions before launch.
6. **Financial retention:** Confirm sponsor invoice/payment record retention with an accountant or legal adviser.
7. **Production notice:** Verify the exact consent wording, version, signup state, Account settings, and policy copy on both web and native before release.

## 7. Reference guidance

- [ICO — Special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/)
- [ICO — Explicit consent conditions](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/)
- [ICO — Consent](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/consent)

The ICO states that special-category processing requires both an Article 6 lawful basis and a separate Article 9 condition. Explicit consent must be freely given, specific, affirmative, clear, identify the nature of the special-category data, be separate from other consents, and be withdrawable. A DPIA is required for processing likely to result in high risk.
