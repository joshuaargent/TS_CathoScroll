import type { OfflineDatabase } from '@/lib/offline/activity-store';

export type CachedProfile = { username: string; displayName: string; bio: string };

function validProfile(profile: CachedProfile): boolean {
  return (
    typeof profile.username === 'string' &&
    typeof profile.displayName === 'string' &&
    typeof profile.bio === 'string'
  );
}

export class NativeProfileCache {
  constructor(private readonly database: OfflineDatabase) {}

  async initialize(): Promise<void> {
    await this.database.transaction((db) =>
      db.execute(`CREATE TABLE IF NOT EXISTS native_profile_cache (
        user_id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        bio TEXT NOT NULL
      )`)
    );
  }

  async load(userId: string): Promise<CachedProfile | null> {
    if (!userId || userId.trim() !== userId) throw new Error('Invalid profile account.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT username, display_name, bio FROM native_profile_cache WHERE user_id = ?',
        [userId]
      );
      if (!rows.length) return null;
      const row = rows[0];
      if (
        rows.length !== 1 ||
        typeof row.username !== 'string' ||
        typeof row.display_name !== 'string' ||
        typeof row.bio !== 'string'
      ) {
        throw new Error('Invalid saved profile.');
      }
      return { username: row.username, displayName: row.display_name, bio: row.bio };
    });
  }

  async save(userId: string, profile: CachedProfile): Promise<void> {
    if (!userId || userId.trim() !== userId || !validProfile(profile)) {
      throw new Error('Invalid saved profile.');
    }
    await this.database.transaction((db) =>
      db.execute(
        'INSERT OR REPLACE INTO native_profile_cache (user_id, username, display_name, bio) VALUES (?, ?, ?, ?)',
        [userId, profile.username, profile.displayName, profile.bio]
      )
    );
  }
}
