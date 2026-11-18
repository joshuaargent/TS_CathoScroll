# Feed card architecture

The topic list remains the source of truth for feed order. Recommendation ranking, topic pagination and the topic viewer are not replaced by card placement.

## Placement engine

`src/lib/feed-entry-system.ts` contains the card-agnostic sequence builder. It accepts an ordered topic list and a set of `FeedCardRule` definitions. Each rule has:

- A stable `id`, used to preserve that card type's independent cadence across appended pages.
- An `interval`, measured in topic advances.
- A `priority`, used to order cards when multiple rules are due at the same topic boundary.
- A `createEntry(topic, topicIndex)` callback, which owns eligibility and inventory selection. Return `null` when no card should be placed.

The engine owns the common scheduling behaviour: it preserves topic order, advances each rule independently, applies deterministic priority ordering, and records cadence at every topic boundary. A rule with no eligible inventory creates no placeholder entry and does not change another rule's cadence.

## Current registered card rules

`src/lib/feed-card-placement-registry.ts` registers the current Top Comments and sponsor placement rules; `src/lib/feed-entry-map.ts` passes those rules to the generic engine and flattens the result for navigation.

- Top Comments: every five topic advances, priority 100.
- Sponsor: every ten topic advances, priority 200.
- When both are due, Top Comments appears first.
- Comment groups reserve their comment IDs so they cannot be assigned to a second placement.
- Sponsor inventory is resolved lazily; confirmed empty inventory removes the slot, while pending inventory remains a planned entry.

The default intervals and priorities are card configuration, not logic in the generic scheduler.

## Adding another card type

A new card should provide a rule with its own stable ID, interval, priority and inventory/eligibility callback. It should not add cadence counters or insertion checks to topic navigation. Add unit tests for its cadence, eligibility, empty inventory and collision ordering.

All feed entry types use the same `FeedProgress` component, extracted without changing the original topic progress track, accent fill, spacing, or 300ms transition. `TopicProgress` remains as a compatibility export. `src/lib/feed-entry-cursor.ts` provides stable entry keys and adjacent-entry traversal over the flattened map; forward and reverse navigation use that ordered cursor so a sponsor follows its comment card in both directions. `src/lib/feed-entry-registry.ts` provides typed renderer/action registration, and `src/components/topic/feed-card-registry.tsx` owns the current Top Comments and sponsor renderers. `TopicFeedCore` supplies shared navigation callbacks and renders the active card through the registry rather than importing card components or branching on their JSX. The registry is generic enough to register a new entry shape, as covered by the poll-type test. The active feed position is represented by one stable entry key for topics and interstitials. All forward and reverse movement goes through `navigateFeedEntry`, which resolves adjacent entries from the same flattened sequence; the separate comment/sponsor navigation handlers and direction flags have been removed. The card renderer registry is outside `TopicFeedCore`, and every registered card receives the same next/previous navigation callbacks. Additional entry types can be entered and traversed through the generic cursor and rendered by registering their component; they do not need a new navigation branch in `TopicFeedCore`. The remaining work is to move the current comment/sponsor inventory-loading lifecycle into card registrations and expose placement rules as a separate registry rather than defining the current two rules inside the map builder.
