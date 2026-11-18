# Sponsor Platform

This document describes the current sponsor workflow, permissions, payment controls and feed behaviour. Sponsor payments are direct bank transfers to CathoScroll; the application does not process payments.

## Feed placement rules

The two interstitial schedules are independent:

- Top Comments becomes eligible after every five topic advances.
- Sponsored campaigns become eligible after every ten topic advances.
- A missing or ineligible inventory item is omitted; it does not create a blank slot or change the other schedule.
- At the tenth-topic boundary, both schedules are due. The feed shows the Top Comments interstitial first and then the sponsored interstitial before advancing to the next topic. No extra topic advance is counted between those two placements.
- A comment card is omitted when no eligible comments are returned. A sponsored card is omitted when the signed-in user has no eligible campaign.
- Sponsor selection never modifies organic recommendation scores or topic ranking.

## Sponsor organisations and account access

A row in `public.sponsors` represents a business or organisation. It is not a login account.

Sponsor identity is text-only. The feed displays the sponsor name as text; sponsor logos are not stored in the database or rendered. Campaign `image_url` remains separate creative media, not a company logo. The live `sponsors.logo_url` column is absent. Until the logo-free application is deployed, a service-role-only compatibility RPC accepts but ignores the old `p_logo_url` argument, and the campaign selector returns `sponsor_logo_url: null` solely for the currently deployed client's validation. Apply [`sponsor-logo-removal.sql`](sponsor-logo-removal.sql) after deployment to remove that temporary API compatibility surface.

Administrators manage sponsor organisations and access at `/admin/sponsors`. They can pause or reactivate an entire sponsor organisation; a paused/completed sponsor is immediately excluded from delivery even if an individual campaign remains approved. Membership changes are audited, and the database prevents suspending or revoking the last active owner.

1. Create the sponsor organisation and record its agreed amount, currency, placement period and private notes.
2. Enter the exact email address of an existing CathoScroll account.
3. Assign one of three organisation-scoped roles:
   - **Owner:** view sponsor information, campaigns, aggregate analytics and invoices; create and edit eligible campaign submissions.
   - **Manager:** same campaign-management permissions as an owner.
   - **Analyst:** read-only access to the organisation's campaigns, aggregate analytics and financial records.
4. Suspend, reactivate or revoke access when the representative changes or leaves.

Account assignment resolves the exact email against Supabase Auth through an administrator-only database function. It does not create an Auth user, send an invitation, change email verification, or change the user's existing sign-in method. The person must already have a CathoScroll account. Email verification remains a separate project setting and is not enabled by this workflow.

Membership rows are private. Browser and native clients have no direct table access. Server routes authenticate the current user, and database functions independently verify the active membership and required role. A user can belong to more than one sponsor organisation; each organisation is isolated from the others.

## Campaign submission and approval

Sponsor representatives use `/sponsor`. The portal shows only organisations to which the current account has an active membership.

Owners and managers can submit campaign creative:

- Campaign name and headline.
- Message text.
- HTTPS image and destination URLs.
- Call-to-action label.
- Start and end dates.
- Optional category and topic targeting.

A submission enters `pending_approval`. Sponsor users cannot set paid delivery weight, global caps or per-user frequency caps; those remain administrator-controlled. Administrators use `/admin/sponsor-campaigns` to review, approve, pause, resume or complete campaigns.

Sponsor users can edit drafts, pending submissions and rejected submissions. Updating a rejected submission resubmits it for review. Approved or paused campaigns cannot be edited directly by sponsor users; changes must be requested from CathoScroll so the live creative and delivery settings remain controlled.

A campaign is not eligible for delivery unless its sponsor is active or scheduled, its payment state is `received` or `not_required`, and the sponsor and campaign date windows, targeting and frequency/delivery caps all pass.

## Bank-transfer invoices and reconciliation

CathoScroll does not collect bank account details, initiate transfers, store card data or integrate a payment processor.

The administrator workflow is:

1. Create the sponsor record with payment status `pending` (or `not_required` only where no payment is due).
2. Create and issue an invoice in the Sponsor financials section of `/admin/sponsors`.
3. The sponsor pays by direct bank transfer outside the application.
4. An administrator checks the bank statement and records the amount received against the issued invoice.
5. The transaction records the amount, currency, bank reference, bank transaction date, optional unique statement transaction ID, administrator and server receipt timestamp.
6. Partial payments reduce the outstanding invoice balance. The system rejects amounts above the current balance.
7. When all issued invoices are fully reconciled and the sponsor's agreed amount has been received, the sponsor payment status becomes `received`. This is the payment condition used by campaign approval and delivery.
8. Refunds are recorded as separate ledger transactions linked to the original payment. A refund cannot exceed the unrefunded amount. If a refund makes an invoice outstanding again, sponsor payment status returns to pending and campaign delivery is no longer eligible.

The ledger is append-only from the application workflow. Duplicate statement transaction IDs are rejected or treated idempotently for a repeated identical payment. The previous direct “mark payment received” override is disabled; payment status is derived through invoice reconciliation rather than a free-form admin toggle.

The sponsor portal can view its own invoice balances and recorded transactions. It never receives another sponsor's financial information, user identities, or raw advertising events.

### Current reconciliation boundaries

The current workflow supports administrator-entered invoices, partial/full bank-transfer recording, duplicate transaction protection, outstanding balances and refunds. It does not yet import bank statement CSV files, automatically match bank transactions, generate/send tax-compliant PDF invoices, calculate VAT, or connect to a bank/payment API. Those require CathoScroll's legal issuer details, tax status and accounting requirements to be confirmed before implementation.

## Reporting and privacy

The sponsor portal reports campaign served counts, viewable impressions, clicks and click-through rate from aggregate daily metrics. Client-side viewable/click events are retained in an account-scoped offline queue capped at 1,000 pending events; acknowledged events are removed and retries reuse stable event IDs. It does not expose individual users, user IDs, session IDs, reading histories, raw event rows or comment data.

Administrators retain the complete sponsor and campaign view. Sponsor members see only their own organisation's campaigns, aggregate performance and invoices. Membership changes, campaign submissions and financial operations are audited.

## Empty inventory behaviour

No fake sponsors or comments are inserted to populate the feed.

- Zero eligible comments means no Top Comments interstitial.
- Zero eligible campaigns means no Sponsored interstitial.
- Organic topics continue without blank placeholders.
- If only one inventory type exists, that type continues on its own cadence.
- If both exist, both appear at their own due boundaries.
- Admin dashboards should distinguish an empty inventory from a failed query or delivery error.

Production currently has no real sponsor records, campaigns, comments or comment likes. The feed therefore remains topic-only until real eligible inventory exists.

## Database objects

Sponsor access:
- `public.sponsor_memberships`
- `catho_private.sponsor_member_audit`
- `public.admin_add_sponsor_member`
- `public.admin_set_sponsor_member_status`
- `public.admin_set_sponsor_status`
- `public.admin_find_sponsor_user_by_email`

Campaign submissions and reporting:
- `public.sponsor_campaigns`
- `public.sponsor_create_campaign`
- `public.sponsor_update_campaign`
- `public.get_sponsor_campaign_analytics`
- `public.get_admin_sponsor_campaign_analytics`

Financial reconciliation:
- `catho_private.sponsor_invoices`
- `catho_private.sponsor_payment_transactions`
- `public.admin_create_sponsor_invoice`
- `public.admin_record_sponsor_payment`
- `public.admin_record_sponsor_refund`
- `public.get_admin_sponsor_financials`
- `public.get_sponsor_financials`

Private tables have RLS enabled and no direct client/service-role table grants where functions provide the required access. Privileged mutations use postgres-owned SECURITY DEFINER functions with an empty search path, explicit administrator or sponsor-membership checks, service-role-only execution and audit records.
