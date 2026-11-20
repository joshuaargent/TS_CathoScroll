import type { OfflineDatabase } from './activity-store';
import type { AnonymousFeedAnalyticsEvent, AnonymousFeedAnalyticsOutbox } from '../anonymous-feed-analytics-client';
const maximumEvents = 2000;
const maximumAgeMs = 7 * 24 * 60 * 60 * 1000;
function validEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validateEvent(event: AnonymousFeedAnalyticsEvent): void {
  if (!event || !validEventId(event.eventId) ||
    (event.entityType !== 'topic' && event.entityType !== 'comment') ||
    typeof event.entityId !== 'string' || !event.entityId || event.entityId.length > 160 || event.entityId.trim() !== event.entityId ||
    !['impression', 'viewable_impression', 'active_duration', 'skip', 'completion', 'open'].includes(event.eventType) ||
    (event.eventType === 'active_duration'
      ? !Number.isSafeInteger(event.durationMs) || Number(event.durationMs) < 0 || Number(event.durationMs) > 60000
      : event.durationMs !== undefined)) throw new Error('Invalid anonymous analytics event.');
}
function eventFromRow(row: Record<string, unknown>): AnonymousFeedAnalyticsEvent {
  const event: AnonymousFeedAnalyticsEvent = {
    eventId: String(row.event_id), entityType: row.entity_type as 'topic' | 'comment',
    entityId: String(row.entity_id), eventType: row.event_type as AnonymousFeedAnalyticsEvent['eventType'],
    ...(row.duration_ms === null ? {} : { durationMs: Number(row.duration_ms) }),
  };
  validateEvent(event);
  return event;
}
/** Stores only anonymous event payloads; no account, visitor or session identity is accepted. */
export class NativeAnonymousAnalyticsOutbox implements AnonymousFeedAnalyticsOutbox {
  constructor(private readonly database: OfflineDatabase) {}
  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.execute("CREATE TABLE IF NOT EXISTS offline_anonymous_analytics_outbox (event_id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL CHECK (entity_type IN ('topic', 'comment')), entity_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'viewable_impression', 'active_duration', 'skip', 'completion', 'open')), duration_ms INTEGER, created_at TEXT NOT NULL)");
      await db.execute('CREATE INDEX IF NOT EXISTS offline_anonymous_analytics_outbox_created ON offline_anonymous_analytics_outbox(created_at)');
      await this.prune(db);
    });
  }
  private async prune(db: { execute(statement: string, values?: Array<string | number | null>): Promise<void> }): Promise<void> {
    await db.execute('DELETE FROM offline_anonymous_analytics_outbox WHERE created_at < ?', [new Date(Date.now() - maximumAgeMs).toISOString()]);
    await db.execute('DELETE FROM offline_anonymous_analytics_outbox WHERE rowid NOT IN (SELECT rowid FROM offline_anonymous_analytics_outbox ORDER BY rowid DESC LIMIT ?)', [maximumEvents]);
  }
  async enqueue(event: AnonymousFeedAnalyticsEvent): Promise<void> {
    validateEvent(event);
    await this.database.transaction(async (db) => {
      await db.execute('INSERT OR IGNORE INTO offline_anonymous_analytics_outbox (event_id, entity_type, entity_id, event_type, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [event.eventId, event.entityType, event.entityId, event.eventType, event.durationMs ?? null, new Date().toISOString()]);
      await this.prune(db);
    });
  }
  async pending(limit: number): Promise<AnonymousFeedAnalyticsEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid anonymous analytics batch size.');
    return this.database.transaction(async (db) => {
      await this.prune(db);
      const rows = await db.query('SELECT event_id, entity_type, entity_id, event_type, duration_ms FROM offline_anonymous_analytics_outbox ORDER BY rowid ASC LIMIT ?', [limit]);
      return rows.map(eventFromRow);
    });
  }
  async acknowledge(eventIds: string[]): Promise<void> {
    if (!Array.isArray(eventIds) || eventIds.length > 100 || eventIds.some((id) => !validEventId(id)) || new Set(eventIds).size !== eventIds.length) {
      throw new Error('Invalid anonymous analytics acknowledgement.');
    }
    if (!eventIds.length) return;
    await this.database.transaction((db) => db.execute(
      'DELETE FROM offline_anonymous_analytics_outbox WHERE event_id IN (' + eventIds.map(() => '?').join(', ') + ')', eventIds
    ));
  }
}
