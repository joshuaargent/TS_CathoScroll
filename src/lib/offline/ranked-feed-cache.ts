import type { Topic } from '@/types';
import type { GeneralFeedCursor } from '@/lib/content';
import type { CatalogueCursor } from './catalogue';
import type { RecommendationCursor } from '@/lib/recommendations';
import type { OfflineDatabase } from './activity-store';
import type { OfflineCatalogue } from './catalogue';

export type RankedFeedMode = 'general' | 'personalized';
export type RankedFeedCursor = CatalogueCursor | GeneralFeedCursor | RecommendationCursor;
export interface RankedFeedPage {
  topics: Topic[];
  nextCursor: RankedFeedCursor | null;
}

export interface CachedPersonalizationConsent {
  enabled: boolean;
  checkedAt: string;
  pendingSync: boolean;
}

const maximumPagesPerOwner = 30;
const maximumPageAgeMs = 14 * 24 * 60 * 60 * 1000;
const consentFreshnessMs = 12 * 60 * 60 * 1000;
const personalizedModelVersion = 'activity-signals-v4';

function assertOwner(mode: RankedFeedMode, userId: string | null): string {
  if (mode === 'general') return 'public';
  if (!userId || userId.trim() !== userId || userId.length > 128) {
    throw new Error('Personalised feed cache requires an account.');
  }
  return userId;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
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
    private readonly catalogue: OfflineCatalogue,
    private readonly allowPersonalizedCache = false
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
      if (this.allowPersonalizedCache) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS offline_ranked_feed_cache_meta (
            cache_key TEXT PRIMARY KEY NOT NULL,
            cache_value TEXT NOT NULL
          )
        `);
        const modelRows = await db.query(
          'SELECT cache_value FROM offline_ranked_feed_cache_meta WHERE cache_key = ?',
          ['personalized_model_version']
        );
        if (modelRows.length !== 1 || modelRows[0].cache_value !== personalizedModelVersion) {
          await db.execute(
            'DELETE FROM offline_ranked_feed_pages WHERE mode = ?',
            ['personalized']
          );
          await db.execute(
            'INSERT OR REPLACE INTO offline_ranked_feed_cache_meta (cache_key, cache_value) VALUES (?, ?)',
            ['personalized_model_version', personalizedModelVersion]
          );
        }
        await db.execute(`
          CREATE TABLE IF NOT EXISTS offline_personalization_consent_cache (
            user_id TEXT PRIMARY KEY NOT NULL,
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            checked_at TEXT NOT NULL,
            pending_sync INTEGER NOT NULL DEFAULT 0 CHECK (pending_sync IN (0, 1))
          )
        `);
        const columns = await db.query('PRAGMA table_info(offline_personalization_consent_cache)');
        if (!columns.some((column) => column.name === 'pending_sync')) {
          await db.execute('ALTER TABLE offline_personalization_consent_cache ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0 CHECK (pending_sync IN (0, 1))');
        }
      }
      await this.prune(db);
    });
  }

  private async prune(db: { execute(statement: string, values?: Array<string | number | null>): Promise<void> }): Promise<void> {
    await db.execute(
      'DELETE FROM offline_ranked_feed_pages WHERE updated_at < ?',
      [new Date(Date.now() - maximumPageAgeMs).toISOString()]
    );
    if (this.allowPersonalizedCache) {
      await db.execute(
        'DELETE FROM offline_personalization_consent_cache WHERE checked_at < ? AND pending_sync = 0',
        [new Date(Date.now() - consentFreshnessMs).toISOString()]
      );
    }
  }

  async save(mode: RankedFeedMode, userId: string | null, cursor: RankedFeedCursor | null, page: RankedFeedPage): Promise<void> {
    const ownerId = assertOwner(mode, userId);
    if (mode === 'personalized' && !this.allowPersonalizedCache) throw new Error('Personalised pages require encrypted private storage.');
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
        'INSERT OR REPLACE INTO offline_ranked_feed_pages (mode, owner_id, cursor_key, topic_ids, next_cursor, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
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
    if (mode === 'personalized' && !this.allowPersonalizedCache) throw new Error('Personalised pages require encrypted private storage.');
    const rows = await this.database.transaction(async (db) => {
      await this.prune(db);
      return db.query(
        'SELECT topic_ids, next_cursor FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ? AND cursor_key = ?',
        [mode, ownerId, cursorKey(cursor)]
      );
    });
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
  }

  async setConsent(userId: string, enabled: boolean, pendingSync = false): Promise<void> {
    assertOwner('personalized', userId);
    if (!this.allowPersonalizedCache) throw new Error('Personalisation consent must use encrypted private storage.');
    if (!enabled) {
      // Persist the denial first. If page deletion encounters a transient
      // storage error, the offline reader still fails closed on the disabled
      // consent row rather than serving a stale personalised ranking.
      await this.database.transaction((db) => db.execute(
        'INSERT OR REPLACE INTO offline_personalization_consent_cache (user_id, enabled, checked_at, pending_sync) VALUES (?, 0, ?, ?)',
        [userId, new Date().toISOString(), pendingSync ? 1 : 0]
      ));
      await this.database.transaction((db) => db.execute(
        'DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ?',
        ['personalized', userId]
      ));
      return;
    }
    await this.database.transaction((db) => db.execute(
      'INSERT OR REPLACE INTO offline_personalization_consent_cache (user_id, enabled, checked_at, pending_sync) VALUES (?, 1, ?, ?)',
      [userId, new Date().toISOString(), pendingSync ? 1 : 0]
    ));
  }

  async hasFreshConsent(userId: string): Promise<boolean> {
    assertOwner('personalized', userId);
    if (!this.allowPersonalizedCache) throw new Error('Personalisation consent must use encrypted private storage.');
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

  async getCachedConsent(userId: string): Promise<CachedPersonalizationConsent | null> {
    assertOwner('personalized', userId);
    if (!this.allowPersonalizedCache) throw new Error('Personalisation consent must use encrypted private storage.');
    return this.database.transaction(async (db) => {
      await this.prune(db);
      const rows = await db.query(
        'SELECT enabled, checked_at, pending_sync FROM offline_personalization_consent_cache WHERE user_id = ?',
        [userId]
      );
      if (
        rows.length !== 1 ||
        (rows[0].enabled !== 0 && rows[0].enabled !== 1) ||
        typeof rows[0].checked_at !== 'string' ||
        (rows[0].pending_sync !== 0 && rows[0].pending_sync !== 1)
      ) return null;
      const checkedAt = Date.parse(rows[0].checked_at);
      const pendingSync = rows[0].pending_sync === 1;
      if (
        !pendingSync &&
        (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > consentFreshnessMs)
      ) return null;
      return {
        enabled: rows[0].enabled === 1,
        checkedAt: rows[0].checked_at,
        pendingSync,
      };
    });
  }

  async getPendingConsent(userId: string): Promise<boolean | null> {
    assertOwner('personalized', userId);
    if (!this.allowPersonalizedCache) throw new Error('Personalisation consent must use encrypted private storage.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT enabled, pending_sync FROM offline_personalization_consent_cache WHERE user_id = ?',
        [userId]
      );
      if (rows.length !== 1 || rows[0].pending_sync !== 1 || (rows[0].enabled !== 0 && rows[0].enabled !== 1)) return null;
      return rows[0].enabled === 1;
    });
  }

  async clearUser(userId: string): Promise<void> {
    assertOwner('personalized', userId);
    if (!this.allowPersonalizedCache) throw new Error('Personalised pages require encrypted private storage.');
    await this.database.transaction(async (db) => {
      await db.execute('DELETE FROM offline_ranked_feed_pages WHERE mode = ? AND owner_id = ?', ['personalized', userId]);
      await db.execute('DELETE FROM offline_personalization_consent_cache WHERE user_id = ? AND pending_sync = 0', [userId]);
    });
  }
}
