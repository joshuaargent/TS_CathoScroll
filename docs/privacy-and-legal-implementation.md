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

CathoScroll's subject matter includes Catholic theology and other religious topics. Reading and interaction patterns may therefore reveal or permit inferences about religious or philosophical beliefs. The system treats this as sensitive processing even though the stored profile is described internally as a content-interest profile.

### Data involved

| Data | Source | Use | Consent state |
|---|---|---|---|
| Topic viewability, active duration, completion, repeat visit, skip | Feed analytics | Topic/category interest evidence | Read for recommendation weighting only when enabled |
| Likes, bookmarks, progress/completions, comments | Existing account activity | Explicit engagement evidence | Read for recommendation weighting only when enabled |
| Selected categories | Account settings | Strong user-declared interest signal | Stored only while enabled |
| Derived topic/category scores | Private profile tables | Rank the user's own recommendations | Created/refreshed only while enabled |
| Consent version and timestamps | Signup trigger / account settings RPC | Demonstrate opt-in and withdrawal | Stored as a private audit record |

The profile is not displayed on public profiles, is not provided to sponsors, and is not used to target sponsored campaigns. No raw comment text is included in the profile. The system does not intentionally infer a user's religious affiliation or make a statement about their beliefs.

### Consent collection and withdrawal

- Consent is off by default and is not required to create or use an account.
- Signup uses a separate, unticked checkbox with an express statement of consent and a link to the Privacy Policy.
- The same shared signup presentation is used on web and native.
- When a new Auth user is inserted with the affirmative signup choice, the private `catho_private.capture_signup_personalization_consent()` trigger records the versioned consent row. A later edit to user metadata does not re-enable consent.
- Existing users can opt in or withdraw in Account settings. The detailed route is `/account/personalization`.
- The shared AccountPageView and PersonalizationSettingsPage are used by web and native; platform-specific authentication/session storage remains in the web/native adapters.
- Withdrawal records the choice, deletes derived topic scores and explicit category choices, and prevents further account-history recommendation weighting.
- Existing cursors are neutralised on the next recommendation RPC call after withdrawal; category weights become equal and completed-topic suppression is disabled. A new sign-in or page reload is not required for this server-side check to take effect.
- Operational analytics records are separate. Withdrawal does not erase those records; they remain under their stated operational retention policy.

Consent version currently recorded by signup and the account RPC: `2026-11-19-v3`.

### Recommendation behaviour

All account-history recommendation weighting is behind the explicit consent flag. This includes the legacy activity inputs (progress, bookmarks, topic likes and comments), derived interest scores, selected categories and feed telemetry.

When consent is disabled:

- The recommendation RPC does not read or aggregate account-history preference signals.
- Every category has a neutral baseline weight.
- Completed-topic history is not used to suppress topics.
- The normal catalogue ordering, pagination, diversity and safety rules remain in place.

When consent is enabled, the existing bounded scoring model applies. Behavioural evidence has a maximum 90-day window; explicit account interactions have a maximum 180-day window. Profile refreshes are cached for five minutes. Sponsor delivery signals are never recommendation inputs.

## Analytics and retention

- Raw topic feed and community-card analytics events are retained for up to 180 days.
- Daily analytics aggregates are retained longer without user or session identifiers.
- Behavioural topic-interest evidence is bounded to 90 days.
- Explicit account-interaction evidence is bounded to 180 days.
- Explicit category selections and derived profile rows are deleted on personalisation withdrawal.
- Sponsor campaign reporting is maintained separately from organic topic and comment recommendation signals.
- Sponsor invoice/payment ledger retention needs a documented accounting retention period, confirmed with the operator's accountant before sponsor volume increases.

Do not describe aggregate analytics as a unique count of all visitors where the relevant pipeline only measures authenticated users.

## Lawful-basis and DPIA work

The current policy wording identifies:
- Article 6(1)(a) UK GDPR consent for optional personalisation; and
- Article 9(2)(a) explicit consent for any personalisation processing that reveals special-category religious or philosophical belief data.

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
