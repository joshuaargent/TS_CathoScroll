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

All feed entry types use the same `FeedProgress` component, extracted without changing the original topic progress track, accent fill, spacing, or 300ms transition. `TopicProgress` remains as a compatibility export. `src/lib/feed-entry-cursor.ts` provides stable entry keys and adjacent-entry traversal over the flattened map; forward and reverse navigation use that cursor so every card remains in the same deterministic sequence. `src/lib/feed-entry-registry.ts` provides typed renderer, action, enter and exit lifecycle registration. `src/components/topic/feed-card-registry.tsx` owns the current Top Comments and sponsor renderers, actions and lifecycle callbacks. `TopicFeedCore` holds one active entry key and delegates rendering and lifecycle dispatch to the registry; it has no comment/sponsor-specific navigation handlers or direction flags. Sponsor inventory resolution is injected as a service and invoked by the sponsor registration when a pending entry is entered. To add a card type, extend the `FeedEntry` union, register its placement rule in `src/lib/feed-card-placement-registry.ts`, and register its renderer/actions/lifecycle in `src/components/topic/feed-card-registry.tsx`. The generic cursor and sequence engine do not need new card-specific branches.
