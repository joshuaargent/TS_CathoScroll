export type FeedTopicLike = { id: string };

export type FeedCardRule<TTopic extends FeedTopicLike, TEntry> = {
  /** Stable identifier used to retain this card type's independent cadence. */
  id: string;
  /** Number of topic advances between eligible placement boundaries. */
  interval: number;
  /** Lower values are placed first when multiple card types share a boundary. */
  priority: number;
  /** Return null when this card has no eligible inventory for this boundary. */
  createEntry: (topic: TTopic, topicIndex: number) => TEntry | null;
};

export type OrderedFeedBoundary<TTopic extends FeedTopicLike, TEntry> = {
  topicId: string;
  entries: Array<{ type: 'topic'; topicId: string; topic: TTopic } | TEntry>;
  cadenceAfter: Readonly<Record<string, number>>;
};

export type BuildOrderedFeedOptions<TTopic extends FeedTopicLike, TEntry> = {
  topics: readonly TTopic[];
  cardRules: readonly FeedCardRule<TTopic, TEntry>[];
  initialCadence?: Readonly<Record<string, number>>;
};

export type OrderedFeedSequence<TTopic extends FeedTopicLike, TEntry> = {
  boundaries: OrderedFeedBoundary<TTopic, TEntry>[];
  cadence: Readonly<Record<string, number>>;
};

/**
 * Generic placement engine for the single ordered feed.
 *
 * Topics always remain in their supplied order. Card rules own their cadence,
 * inventory decision and priority; the engine owns deterministic ordering.
 * A missing inventory item consumes that rule's due boundary but creates no
 * phantom entry. Adding a new card type requires a rule, not new navigation
 * scheduling logic.
 */
export function buildOrderedFeedSequence<TTopic extends FeedTopicLike, TEntry>({
  topics,
  cardRules,
  initialCadence = {},
}: BuildOrderedFeedOptions<TTopic, TEntry>): OrderedFeedSequence<TTopic, TEntry> {
  const ruleIds = new Set<string>();
  for (const rule of cardRules) {
    if (!rule.id.trim()) throw new TypeError('Feed card rule id cannot be empty');
    if (ruleIds.has(rule.id)) throw new TypeError(`Duplicate feed card rule id: ${rule.id}`);
    if (!Number.isSafeInteger(rule.interval) || rule.interval < 1) {
      throw new RangeError(`Feed card rule interval must be a positive integer: ${rule.id}`);
    }
    if (!Number.isFinite(rule.priority)) {
      throw new RangeError(`Feed card rule priority must be finite: ${rule.id}`);
    }
    ruleIds.add(rule.id);
  }

  const orderedRules = [...cardRules].sort(
    (left, right) => left.priority - right.priority || left.id.localeCompare(right.id)
  );
  const cadence: Record<string, number> = {};
  for (const rule of orderedRules) {
    const previous = initialCadence[rule.id] ?? 0;
    if (!Number.isSafeInteger(previous) || previous < 0 || previous >= rule.interval) {
      throw new RangeError(`Invalid initial cadence for feed card rule: ${rule.id}`);
    }
    cadence[rule.id] = previous;
  }

  const boundaries: OrderedFeedBoundary<TTopic, TEntry>[] = [];
  for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
    const topic = topics[topicIndex];
    const entries: OrderedFeedBoundary<TTopic, TEntry>['entries'] = [
      { type: 'topic', topicId: topic.id, topic },
    ];

    for (const rule of orderedRules) {
      const nextCadence = (cadence[rule.id] + 1) % rule.interval;
      cadence[rule.id] = nextCadence;
      if (nextCadence !== 0) continue;
      const entry = rule.createEntry(topic, topicIndex);
      if (entry !== null) entries.push(entry);
    }

    boundaries.push({
      topicId: topic.id,
      entries,
      cadenceAfter: { ...cadence },
    });
  }

  return { boundaries, cadence: { ...cadence } };
}
