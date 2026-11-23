# Sponsor platform

## Delivery

Approved, active and paid/cleared campaigns can be selected for eligible placements in the shared web/native feed. Campaign eligibility checks sponsor status, payment status, campaign dates and configured category/topic targeting. The feed cadence and sponsor placement UI are independent of analytics consent.

Sponsor selection and display are not measured for users without Sponsor measurement consent. The selector does not create a served event, campaign/day counter, delivery total, anonymous session token, frequency row or analytics receipt. There is no total-delivery or anonymous-reach figure.

## Sponsor measurement

Detailed measurement is a separate explicit opt-in for signed-in accounts. When enabled, the system records only:
- A viewable impression after at least 50% of the card remains visible for one continuous second while the page is visible.
- A click after a valid viewable impression.
- Bounded active viewing duration while the card is visible and the page is active.
- Account-level frequency derived from those consented viewable-impression events.

Events are account-linked and use campaign, event, session and server-issued placement-receipt identifiers. Active-duration events carry a bounded `duration_ms` value and require a prior qualifying viewable impression. The receipt is created only for opted-in selection, stored for up to seven days, and deleted when consent is withdrawn. Events do not include topic IDs, category IDs or reading history. Sponsor measurement must not be used for organic feed ranking, recommendation profiles or belief-based sponsor targeting.

Sponsor/admin reports contain only viewable impressions, clicks on viewable placements, bounded active viewing duration and click-through rate from the opted-in population. They must not be labelled as total campaign deliveries, total reach or total-platform performance. CTR uses clicks divided by viewable impressions from the same opted-in population.

## Frequency and caps

Per-account frequency limits are derived from opted-in viewable-impression events. The per-user campaign cap is rolling 180 days, matching raw-event retention. Daily and lifetime campaign-wide impression caps, where configured, are evaluated only against opted-in viewable impressions and use non-identifying daily aggregates. The selector checks caps before issuing a placement receipt, and the event recorder checks them again while holding a campaign-row lock so concurrent placements cannot exceed the opted-in measurement caps. A placement that reaches a cap is not added to measurement totals. They do not count unmeasured deliveries and must not be described as all-visitor delivery caps.

## Consent and offline

The client sends sponsor events only for signed-in accounts with Sponsor measurement enabled. The API and database independently verify consent. Website retries remain memory-only. Android and Electron use the encrypted signed-in sponsor outbox, capped at 2,000 events and seven days, with acknowledgement deletion and withdrawal/account-change cleanup.

No anonymous sponsor measurement queue, anonymous sponsor event endpoint, anonymous session-frequency table or sponsor delivery counter is retained. Sponsor cards remain available when measurement is declined.

## Governance

Do not send raw user-level sponsor events or reading histories to sponsors. Keep sponsor measurement separate from Service improvement analytics and Personalisation. Review the sponsor copy, privacy notice, processor arrangements, retention and UK GDPR Article 6/9/PECR position before release.
