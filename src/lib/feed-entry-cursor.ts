import type { FeedEntryLike } from './feed-entry-registry';

export type FeedEntryCursor = {
  key: string;
  index: number;
};

export function getFeedEntryKey(entry: FeedEntryLike): string {
  return `${entry.type}:${entry.topicId}`;
}

export function findFeedEntryCursor<TEntry extends FeedEntryLike>(
  entries: readonly TEntry[],
  key: string
): FeedEntryCursor | null {
  const index = entries.findIndex((entry) => getFeedEntryKey(entry) === key);
  return index < 0 ? null : { key, index };
}

export function getAdjacentFeedEntry<TEntry extends FeedEntryLike>(
  entries: readonly TEntry[],
  cursorKey: string,
  direction: 'next' | 'previous'
): { entry: TEntry; cursor: FeedEntryCursor } | null {
  const cursor = findFeedEntryCursor(entries, cursorKey);
  if (!cursor) return null;
  const index = cursor.index + (direction === 'next' ? 1 : -1);
  const entry = entries[index];
  return entry ? { entry, cursor: { key: getFeedEntryKey(entry), index } } : null;
}

/**
 * Re-resolves a cursor after the sequence is rebuilt or a page is appended.
 * The stable entry key preserves the active position; if that entry was
 * removed because its inventory disappeared, the topic anchor is preferred.
 */
export function reconcileFeedEntryCursor<TEntry extends FeedEntryLike>(
  entries: readonly TEntry[],
  currentKey: string,
  topicId: string
): FeedEntryCursor | null {
  return findFeedEntryCursor(entries, currentKey) ??
    findFeedEntryCursor(entries, `topic:${topicId}`);
}
