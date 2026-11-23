# General feed ranking

## Ranking model

CathoScroll has three distinct content-ordering modes:

1. **General feed:** a shared site-wide ranking for signed-in and signed-out readers. It uses public interaction signals (likes, bookmarks and top-level comments), curated topic order, recency, category-exposure balancing and only the signed-in Service improvement aggregates permitted by consent. It does not use anonymous engagement analytics or sponsor activity.
2. **Category pages:** curated `order_index, id` order within the selected published category.
3. **Personalised feed:** available only after the account holder explicitly enables Personalisation. A private account profile schedules categories; topics within each category remain in curated order.

Sponsor selection is a separate placement system. Sponsor delivery and sponsor measurement never influence organic topic ranking.

## General ranking implementation

The production selector is `public.get_public_general_topic_page(jsonb, integer)`. Its score uses public interaction counts and the signed-in feed analytics daily rollup, which receives only events from users who enabled Service improvement analytics. The query does not read anonymous topic/comment tables, visitor IDs, session IDs, sponsor events or sponsor delivery counts.

The selector computes topic scores once per page, then chooses the next topic from the least-served eligible category. Its opaque cursor preserves category offsets and exposure counts and avoids a third consecutive topic from the same category when another eligible category exists. These cursor values are local pagination state, not analytics records.

## Category pages

A category page is a curated browse view. It filters published topics to the selected category and orders them by editorial `order_index, id`. It does not read account history, analytics, sponsor events or anonymous activity.

## Personalisation

The recommendation RPC uses the account's private post-consent profile and explicitly selected category interests. It does not use sponsor activity. Turning Personalisation off stops new recommendation-signal processing and deletes the derived profile and selected interests according to the consent implementation.

Native Android and Electron clients can display previously downloaded server-ranked pages from encrypted offline storage. They do not run a separate offline recommendation learner.

## Analytics boundary

CathoScroll does not collect anonymous topic impressions, comment-card exposures, sponsor viewability, sponsor clicks, sponsor duration, anonymous frequency, or sponsor delivery counts. No anonymous analytics queue or anonymous analytics database pipeline is part of the product.

Signed-in Service improvement analytics and signed-in Sponsor measurement are separate opt-in streams. Their aggregates may be used for their disclosed purposes only. Sponsor measurement is never used for organic ranking, recommendation profiles or religious-interest ad targeting.

## Operational checks

- Keep the general ranking independent of sponsor campaign data.
- Keep category balancing and cursor continuity when changing ranking weights.
- Do not add anonymous engagement aggregates as a ranking input.
- Keep sponsor delivery selection separate from feed ordering.
- Treat all account-linked reading signals as potentially sensitive because the subject matter can reveal or permit inference of religious or philosophical beliefs.
