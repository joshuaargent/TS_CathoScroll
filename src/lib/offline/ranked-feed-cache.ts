import type { Topic } from '@/types';
import type { GeneralFeedCursor } from '@/lib/content';
import type { RecommendationCursor } from '@/lib/recommendations';
import type { OfflineDatabase } from './activity-store';
import type { OfflineCatalogue } from './catalogue';

export type RankedFeedMode = 'general' | 'personalized';
export type RankedFeedCursor = GeneralFeedCursor | RecommendationCursor;
export interface RankedFeedPage {
  topics: Topic[];
  nextCursor: RankedFeedCursor | null;
}

const maximumPagesPerOwner = 30;
const maximumPageAgeMs = 14 * 24 * 60 * 60 * 1000;
const consentFreshnessMs = 12 * 60 * 60 * 1000;

function assertOwner(mode: RankedFeedMode, userId: string | null): string {
  if (mode === 'general') return 'public';
  if (!userId || userId.trim() !== userId || userId.length > 128) {
    throw new Error('Personalised feed cache requires an account.');
  }
  return userId;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableJson(record[key])).join(',') + '}';
}

function cursorKey(cursor: RankedFeedCursor | null): string {
  return cursor === null ? 'first' : stableJson(cursor);
}

export class OfflineRankedFeedCache {
  constructor(
    private readonly database: OfflineDatabase,
    private readonly catalogue: OfflineCatalogue
  ) {}

  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_ranked_feed_pages (
          mode TEXT NOT NULL CHECK (mode IN ('general', 'personalized')),
          owner_id TEXT NOT NULL,
          cursor_key TEXT NOT NULL,
          topic_ids TEXT NOT NULL,
          next_cursor TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (mode, owner_id, cursor_key)
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS offline_ranked_feed_pages_updated
        ON offline_ranked_feed_pages(mode, owner_id, updated_at)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS offline_personalization_consent_cache (
          user_id TEXT PRIMARY KEY NOT NULL,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          checked_at TEXT NOT NULL
        )
      `);
      await this.prune(db);
    });
  }

  private async prune(db: { execute(statement: string, values?: Array<string | number | null>): Promise<void> }): Promise<void> {
    await db.execute(
      'DELETE FROM offline_ranked_feed_pages WHERE updated_at < ?',
      [new Date(Date.now() - maximumPageAgeMs).toISOString()]
    );
    await db.execute(
      'DELETE FROM offline_ranked_feed_pages WHERE rowid NOT IN (SELECT rowid FROM offline_ranked_feed_pages AS p2 WHERE p2.mode = offline_ranked_feed_pages.mode AND p2.owner_id = offline_ranked_feed_pages.owner_id ORDER BY p2.updated_at DESC LIMIT ?)',
      [maximumPagesPerOwner]
    );
    await db.execute(
      'DELETE FROM offline_personalization_consent_cache WHERE checked_at < ?',
      [new Date(Date.now() - consentFreshnessMs).toISOString()]
    );
  }

  async save(mode: RankedFeedMode, userId: string | null, cursor: RankedFeedCursor | null, page: RankedFeedPage): Promise<void> {
    const ownerId = assertOwner(mode, userId);
    if (!page || !Array.isArray(page.topics) || page.topics.length > 50 ||
      page.topics.some((topic) => !topic || typeof topic.id !== 'string' || !topic.id || topic.id.length > 100) ||
      new Set(page.topics.map((topic) => topic.id)).size !== page.topics.length) {
      throw new Error('Invalid ranked feed page for offline caching.');
    }
    const ids = JSON.stringify(page.topics.map((topic) => topic.id));
    const nextCursor = page.nextCursor === null ? null : stableJson(page.nextCursor);
    if (ids.length > 12_000 || (nextCursor !== null && nextCursor.length > 16_384)) {
      throw new Error('Ranked feed page exceeds the offline cache limit.');
    }
    await this.database.transaction(async (db) => {
      await db.execute(
        'INSERT INTO offline_ranked_feed_pages (mode, owner_id, cursor_key, topic_ids, next_cursor, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(mode, owner_id, cursor_key) DO UPDATE SET topic_ids = excluded.topic_ids, next_cursor = excluded.next_cursor, updated_at = excluded.updated_at',
        [mode, ownerId, cursorKey(cursor), ids, nextCursor, new Date().toISOString()]
      );
      await db.execute(
        'DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ? AND cursor_key NOT IN (SELECT cursor_key FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT ?)',
        [mode, ownerId, mode, ownerId, maximumPagesPerOwner]
      );
    });
  }

  async load(mode: RankedFeedMode, userId: string | null, cursor: RankedFeedCursor | null): Promise<RankedFeedPage | null> {
    const ownerId = assertOwner(mode, userId);
    return this.database.transaction(async (db) => {
      await this.prune(db);
      const rows = await db.query(
        'SELECT topic_ids, next_cursor FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ? AND cursor_key = ?',
        [mode, ownerId, cursorKey(cursor)]
      );
      if (rows.length !== 1 || typeof rows[0].topic_ids !== 'string') return null;
      let ids: unknown;
      let nextCursor: unknown;
      try {
        ids = JSON.parse(rows[0].topic_ids);
        nextCursor = rows[0].next_cursor === null ? null : JSON.parse(String(rows[0].next_cursor));
      } catch {
        return null;
      }
      if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string')) return null;
      const topics = await this.catalogue.topicsByIds(ids);
      if (topics.length !== ids.length) return null;
      if (nextCursor !== null && (typeof nextCursor !== 'object' || Array.isArray(nextCursor))) return null;
      return { topics, nextCursor: nextCursor as RankedFeedCursor | null };
    });
  }

  async setConsent(userId: string, enabled: boolean): Promise<void> {
    assertOwner('personalized', userId);
    await this.database.transaction(async (db) => {
      if (!enabled) {
        await db.execute('DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ?', ['personalized', userId]);
        await db.execute('DELETE FROM offline_personalization_consent_cache WHERE user_id = ?', [userId]);
        return;
      }
      await db.execute(
        'INSERT INTO offline_personalization_consent_cache (user_id, enabled, checked_at) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET enabled = 1, checked_at = excluded.checked_at',
        [userId, new Date().toISOString()]
      );
    });
  }

  async hasFreshConsent(userId: string): Promise<boolean> {
    assertOwner('personalized', userId);
    return this.database.transaction(async (db) => {
      await this.prune(db);
      const rows = await db.query(
        'SELECT enabled, checked_at FROM offline_personalization_consent_cache WHERE user_id = ?',
        [userId]
      );
      if (rows.length !== 1 || rows[0].enabled !== 1 || typeof rows[0].checked_at !== 'string') return false;
      const checkedAt = Date.parse(rows[0].checked_at);
      return Number.isFinite(checkedAt) && checkedAt <= Date.now() && Date.now() - checkedAt <= consentFreshnessMs;
    });
  }

  async clearUser(userId: string): Promise<void> {
    assertOwner('personalized', userId);
    await this.database.transaction(async (db) => {
      await db.execute('DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ?', ['personalized', userId]);
      await db.execute('DELETE FROM offline_personalization_consent_cache WHERE user_id = ?', [userId]);
    });
  }
}
