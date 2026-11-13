import type { Comment } from '@/lib/supabase/types';
import type { OfflineDatabase } from './activity-store';

export interface CachedComments {
  comments: Comment[];
  savedAt: string;
}

function publicComments(value: unknown, topicId: string, depth = 0): Comment[] {
  if (!Array.isArray(value) || depth > 100) throw new Error('Invalid cached comment tree.');
  return value.map((entry: unknown): Comment => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid cached comment.');
    const row = entry as Record<string, unknown>;
    if (!row.profile || typeof row.profile !== 'object') {
      throw new Error('Invalid cached comment profile.');
    }
    const profile = row.profile as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.id) ||
      typeof row.id !== 'number' ||
      row.id < 1 ||
      row.topic_id !== topicId ||
      typeof row.user_id !== 'string' ||
      (row.parent_id !== null &&
        (typeof row.parent_id !== 'number' || !Number.isSafeInteger(row.parent_id))) ||
      typeof row.content !== 'string' ||
      typeof row.created_at !== 'string' ||
      (row.edited_at !== null && typeof row.edited_at !== 'string') ||
      typeof row.is_deleted !== 'boolean' ||
      typeof row.is_pinned !== 'boolean' ||
      typeof row.likes !== 'number' ||
      !Number.isSafeInteger(row.likes) ||
      row.likes < 0 ||
      typeof profile.username !== 'string' ||
      typeof profile.display_name !== 'string'
    ) {
      throw new Error('Invalid cached comment.');
    }
    return {
      id: row.id,
      user_id: row.user_id,
      topic_id: topicId,
      parent_id: row.parent_id,
      content: row.is_deleted ? '' : row.content,
      created_at: row.created_at,
      edited_at: row.edited_at,
      is_deleted: row.is_deleted,
      is_pinned: row.is_pinned,
      profile: {
        id: row.user_id,
        username: profile.username,
        display_name: profile.display_name,
        bio: null,
        created_at: '',
        subscription_tier: 'free',
      },
      likes: row.likes,
      likedByUser: false,
      replies: publicComments(row.replies, topicId, depth + 1),
    };
  });
}

export class OfflineCommentCache {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction((db) =>
      db.execute(`CREATE TABLE IF NOT EXISTS offline_comment_cache (
        topic_id TEXT PRIMARY KEY NOT NULL,
        comments TEXT NOT NULL,
        saved_at TEXT NOT NULL
      )`)
    );
  }

  async save(topicId: string, comments: Comment[]): Promise<void> {
    if (!topicId || topicId.trim() !== topicId) throw new Error('Invalid topic ID.');
    const sanitized = publicComments(comments, topicId);
    const savedAt = new Date().toISOString();
    await this.database.transaction((db) =>
      db.execute('INSERT OR REPLACE INTO offline_comment_cache VALUES (?, ?, ?)', [
        topicId,
        JSON.stringify(sanitized),
        savedAt,
      ])
    );
  }

  async load(topicId: string): Promise<CachedComments | null> {
    if (!topicId || topicId.trim() !== topicId) throw new Error('Invalid topic ID.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT comments, saved_at FROM offline_comment_cache WHERE topic_id = ?',
        [topicId]
      );
      if (!rows.length) return null;
      if (
        rows.length !== 1 ||
        typeof rows[0].comments !== 'string' ||
        typeof rows[0].saved_at !== 'string' ||
        Number.isNaN(Date.parse(rows[0].saved_at))
      ) {
        throw new Error('Invalid cached comments.');
      }
      const parsed: unknown = JSON.parse(rows[0].comments);
      return { comments: publicComments(parsed, topicId), savedAt: rows[0].saved_at };
    });
  }
}
