import type { OfflineDatabase } from './activity-store';

export interface CachedTopicCounts {
  likes: number;
  comments: number;
  savedAt: string;
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class OfflineTopicCountCache {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction((db) =>
      db.execute(`CREATE TABLE IF NOT EXISTS offline_topic_counts (
        topic_id TEXT PRIMARY KEY NOT NULL,
        likes INTEGER NOT NULL CHECK (likes >= 0),
        comments INTEGER NOT NULL CHECK (comments >= 0),
        saved_at TEXT NOT NULL
      )`)
    );
  }

  async save(topicId: string, likes: number, comments: number): Promise<CachedTopicCounts> {
    if (!topicId || topicId.trim() !== topicId || !validCount(likes) || !validCount(comments)) {
      throw new Error('Invalid topic counts.');
    }
    const savedAt = new Date().toISOString();
    await this.database.transaction((db) =>
      db.execute('INSERT OR REPLACE INTO offline_topic_counts VALUES (?, ?, ?, ?)', [
        topicId,
        likes,
        comments,
        savedAt,
      ])
    );
    return { likes, comments, savedAt };
  }

  async load(topicId: string): Promise<CachedTopicCounts | null> {
    if (!topicId || topicId.trim() !== topicId) throw new Error('Invalid topic ID.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT likes, comments, saved_at FROM offline_topic_counts WHERE topic_id = ?',
        [topicId]
      );
      if (!rows.length) return null;
      const row = rows[0];
      if (
        rows.length !== 1 ||
        !validCount(row.likes) ||
        !validCount(row.comments) ||
        typeof row.saved_at !== 'string' ||
        Number.isNaN(Date.parse(row.saved_at))
      ) {
        throw new Error('Invalid cached topic counts.');
      }
      return { likes: row.likes, comments: row.comments, savedAt: row.saved_at };
    });
  }
}
