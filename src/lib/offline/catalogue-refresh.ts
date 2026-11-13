import type { OfflineDatabase, OfflineTransaction } from './activity-store';

export interface CatalogueCategoryRecord {
  slug: string;
  name: string;
  description: string;
  orderIndex: number;
}

export interface CatalogueTopicRecord {
  id: string;
  slug: string;
  categorySlug: string;
  orderIndex: number;
  question: string;
  answer: string;
  explanation: string;
  catechismParagraphs: string[];
  catechismText: string;
  scriptureReference: string;
  scriptureText: string;
}

export interface CatalogueRefreshTransport {
  head(signal?: AbortSignal): Promise<string>;
  counts(signal?: AbortSignal): Promise<{ revision: string; categories: number; topics: number }>;
  categories(after: string | null, signal?: AbortSignal): Promise<CatalogueCategoryRecord[]>;
  topics(after: string | null, signal?: AbortSignal): Promise<CatalogueTopicRecord[]>;
}

const pageSize = 100;

function validRevision(value: string): boolean {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

function validKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
  );
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4 * 1024 * 1024;
}

function checkCategory(row: CatalogueCategoryRecord): void {
  if (
    !row ||
    !validKey(row.slug) ||
    !validKey(row.name) ||
    !validText(row.description) ||
    !Number.isSafeInteger(row.orderIndex)
  )
    throw new Error('Invalid category in catalogue update.');
}

function checkTopic(row: CatalogueTopicRecord): void {
  if (
    !row ||
    !validKey(row.id) ||
    !validKey(row.slug) ||
    !validKey(row.categorySlug) ||
    !Number.isSafeInteger(row.orderIndex) ||
    ![
      row.question,
      row.answer,
      row.explanation,
      row.catechismText,
      row.scriptureReference,
      row.scriptureText,
    ].every(validText) ||
    !Array.isArray(row.catechismParagraphs) ||
    !row.catechismParagraphs.every(validText)
  )
    throw new Error('Invalid topic in catalogue update.');
}

export class CatalogueRefresh {
  private running: Promise<boolean> | null = null;

  constructor(
    private readonly database: OfflineDatabase,
    private readonly transport: CatalogueRefreshTransport
  ) {}

  async initialize(): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS catalogue_sync_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision TEXT NOT NULL
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS catalogue_sync_staging (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        snapshot_id TEXT NOT NULL
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS catalogue_staged_categories (
        slug TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        order_index INTEGER NOT NULL
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS catalogue_staged_topics (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        category_slug TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        explanation TEXT NOT NULL,
        catechism_paragraphs TEXT NOT NULL,
        catechism_text TEXT NOT NULL,
        scripture_reference TEXT NOT NULL,
        scripture_text TEXT NOT NULL
      )`);
    });
  }

  refresh(signal?: AbortSignal): Promise<boolean> {
    if (this.running) return this.running;
    const operation = this.refreshSnapshot(signal);
    this.running = operation;
    const clear = () => {
      if (this.running === operation) this.running = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async refreshSnapshot(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const revision = await this.transport.head(signal);
    if (!validRevision(revision)) throw new Error('Invalid catalogue revision.');
    const saved = await this.database.transaction(async (db) => {
      const rows = await db.query('SELECT revision FROM catalogue_sync_state WHERE singleton = 1');
      if (rows.length > 1 || (rows.length && !validRevision(String(rows[0].revision)))) {
        throw new Error('Invalid saved catalogue revision.');
      }
      return rows.length ? String(rows[0].revision) : null;
    });
    if (saved === revision) return false;
    if (saved !== null && BigInt(revision) < BigInt(saved)) {
      throw new Error('The catalogue revision went backwards.');
    }
    const counts = await this.transport.counts(signal);
    if (
      !counts ||
      counts.revision !== revision ||
      !Number.isSafeInteger(counts.categories) ||
      counts.categories < 0 ||
      !Number.isSafeInteger(counts.topics) ||
      counts.topics < 0
    )
      throw new Error('Invalid or changed catalogue counts.');

    const snapshotId = crypto.randomUUID();
    await this.database.transaction(async (db) => {
      await db.execute('DELETE FROM catalogue_staged_topics');
      await db.execute('DELETE FROM catalogue_staged_categories');
      await db.execute('INSERT OR REPLACE INTO catalogue_sync_staging VALUES (1, ?)', [snapshotId]);
    });

    await this.loadPages(snapshotId, 'category', counts.categories, signal);
    await this.loadPages(snapshotId, 'topic', counts.topics, signal);
    signal?.throwIfAborted();
    const finalRevision = await this.transport.head(signal);
    if (!validRevision(finalRevision) || finalRevision !== revision) {
      throw new Error('The catalogue changed during its update. It will be retried.');
    }
    signal?.throwIfAborted();
    await this.database.transaction(async (db) => {
      await this.assertSnapshot(db, snapshotId);
      const invalid = await db.query(`
        SELECT 1 FROM catalogue_staged_topics t
        LEFT JOIN catalogue_staged_categories c ON c.slug = t.category_slug
        WHERE c.slug IS NULL LIMIT 1
      `);
      if (invalid.length) throw new Error('A catalogue topic has no published category.');
      const metadata = await db.query(
        'SELECT singleton FROM catalogue_metadata WHERE singleton = 1'
      );
      if (metadata.length !== 1) throw new Error('Offline catalogue metadata is missing.');
      await db.execute('DELETE FROM topics');
      await db.execute('DELETE FROM categories');
      await db.execute(`INSERT INTO categories (slug, name, description, order_index)
        SELECT slug, name, description, order_index FROM catalogue_staged_categories`);
      await db.execute(`INSERT INTO topics (
        id, slug, category_slug, order_index, question, answer, explanation,
        catechism_paragraphs, catechism_text, scripture_reference, scripture_text
      ) SELECT id, slug, category_slug, order_index, question, answer, explanation,
        catechism_paragraphs, catechism_text, scripture_reference, scripture_text
        FROM catalogue_staged_topics`);
      await db.execute(`UPDATE catalogue_metadata SET
        category_count = (SELECT COUNT(*) FROM catalogue_staged_categories),
        topic_count = (SELECT COUNT(*) FROM catalogue_staged_topics)
        WHERE singleton = 1`);
      await db.execute('INSERT OR REPLACE INTO catalogue_sync_state VALUES (1, ?)', [revision]);
      await db.execute('DELETE FROM catalogue_staged_topics');
      await db.execute('DELETE FROM catalogue_staged_categories');
      await db.execute(
        'DELETE FROM catalogue_sync_staging WHERE singleton = 1 AND snapshot_id = ?',
        [snapshotId]
      );
    });
    return true;
  }

  private async assertSnapshot(db: OfflineTransaction, snapshotId: string): Promise<void> {
    const rows = await db.query(
      'SELECT snapshot_id FROM catalogue_sync_staging WHERE singleton = 1'
    );
    if (rows.length !== 1 || rows[0].snapshot_id !== snapshotId) {
      throw new Error('The catalogue update was superseded.');
    }
  }

  private async loadPages(
    snapshotId: string,
    type: 'category' | 'topic',
    expected: number,
    signal?: AbortSignal
  ) {
    let cursor: string | null = null;
    let received = 0;
    const seen = new Set<string>();
    for (;;) {
      signal?.throwIfAborted();
      if (type === 'category') {
        const rows = await this.transport.categories(cursor, signal);
        if (!Array.isArray(rows) || rows.length > pageSize)
          throw new Error('Invalid category page.');
        rows.forEach(checkCategory);
        signal?.throwIfAborted();
        await this.database.transaction(async (db) => {
          await this.assertSnapshot(db, snapshotId);
          for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            await db.execute(
              `INSERT INTO catalogue_staged_categories VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`,
              batch.flatMap((row) => [row.slug, row.name, row.description, row.orderIndex])
            );
          }
        });
        received += rows.length;
        if (received > expected) throw new Error('The category count changed during the update.');
        if (!rows.length) {
          if (received !== expected) throw new Error('The category update is incomplete.');
          return;
        }
        cursor = rows[rows.length - 1].slug;
      } else {
        const rows = await this.transport.topics(cursor, signal);
        if (!Array.isArray(rows) || rows.length > pageSize) throw new Error('Invalid topic page.');
        rows.forEach(checkTopic);
        signal?.throwIfAborted();
        await this.database.transaction(async (db) => {
          await this.assertSnapshot(db, snapshotId);
          for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            await db.execute(
              `INSERT INTO catalogue_staged_topics VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
              batch.flatMap((row) => [
                row.id,
                row.slug,
                row.categorySlug,
                row.orderIndex,
                row.question,
                row.answer,
                row.explanation,
                JSON.stringify(row.catechismParagraphs),
                row.catechismText,
                row.scriptureReference,
                row.scriptureText,
              ])
            );
          }
        });
        received += rows.length;
        if (received > expected) throw new Error('The topic count changed during the update.');
        if (!rows.length) {
          if (received !== expected) throw new Error('The topic update is incomplete.');
          return;
        }
        cursor = rows[rows.length - 1].id;
      }
      if (!cursor || seen.has(cursor)) throw new Error('The catalogue page cursor was repeated.');
      seen.add(cursor);
    }
  }
}
