import type { FeedEntry } from './feed-entry-map';

export type FeedEntryCursor = {
  key: string;
  index: number;
};

export function getFeedEntryKey(entry: FeedEntry): string {
  switch (entry.type) {
    case 'topic':
      return `topic:${entry.topicId}`;
    case 'top-comments':
      return `top-comments:${entry.topicId}`;
    case 'sponsor':
      return `sponsor:${entry.topicId}`;
  }
}

export function findFeedEntryCursor(
  entries: readonly FeedEntry[],
  key: string
): FeedEntryCursor | null {
  const index = entries.findIndex((entry) => getFeedEntryKey(entry) === key);
  return index < 0 ? null : { key, index };
}

export function getAdjacentFeedEntry(
  entries: readonly FeedEntry[],
  cursorKey: string,
  direction: 'next' | 'previous'
): { entry: FeedEntry; cursor: FeedEntryCursor } | null {
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
export function reconcileFeedEntryCursor(
  entries: readonly FeedEntry[],
  currentKey: string,
  topicId: string
): FeedEntryCursor | null {
  return findFeedEntryCursor(entries, currentKey) ??
    findFeedEntryCursor(entries, `topic:${topicId}`);
}
