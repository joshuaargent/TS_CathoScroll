import type { ContentCategory, Topic } from '@/types';
import type { OfflineDatabase } from './activity-store';

export interface CatalogueCursor {
  orderIndex: number;
  id: string;
}

export interface CategoryCursor {
  orderIndex: number;
  slug: string;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid offline catalogue text.');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Invalid offline catalogue order.');
  }
  return value;
}

function topicFromRow(row: Record<string, unknown>): Topic {
  const paragraphs: unknown = JSON.parse(text(row.catechism_paragraphs));
  if (!Array.isArray(paragraphs) || paragraphs.some((paragraph) => typeof paragraph !== 'string')) {
    throw new Error('Invalid offline Catechism references.');
  }
  return {
    id: text(row.id),
    slug: text(row.slug),
    category: text(row.category_name),
    question: text(row.question),
    answer: text(row.answer),
    explanation: text(row.explanation),
    catechism: { paragraphs, text: text(row.catechism_text) },
    scripture: { reference: text(row.scripture_reference), text: text(row.scripture_text) },
  };
}

const fields = `t.id, t.slug, t.order_index, t.question, t.answer, t.explanation,
  t.catechism_paragraphs, t.catechism_text, t.scripture_reference, t.scripture_text,
  c.name AS category_name`;

function categoryFromRow(row: Record<string, unknown>): ContentCategory {
  return {
    slug: text(row.slug),
    name: text(row.name),
    description: text(row.description),
    orderIndex: integer(row.order_index),
  };
}

export class OfflineCatalogue {
  constructor(private readonly database: OfflineDatabase) {}

  async totals(): Promise<{ categories: number; topics: number }> {
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT category_count, topic_count FROM catalogue_metadata WHERE singleton = 1'
      );
      if (rows.length !== 1) throw new Error('Offline catalogue metadata is missing.');
      const categories = integer(rows[0].category_count);
      const topics = integer(rows[0].topic_count);
      if (categories < 0 || topics < 0) throw new Error('Invalid offline catalogue counts.');
      return { categories, topics };
    });
  }

  async categoryTopicCount(slug: string): Promise<number> {
    if (!slug || slug.trim() !== slug) throw new Error('Invalid offline category slug.');
    return this.database.transaction(async (db) => {
      const rows = await db.query('SELECT COUNT(*) AS count FROM topics WHERE category_slug = ?', [
        slug,
      ]);
      if (rows.length !== 1) throw new Error('Unable to count offline category topics.');
      const count = integer(rows[0].count);
      if (count < 0) throw new Error('Invalid offline category count.');
      return count;
    });
  }

  async topic(slug: string): Promise<Topic | null> {
    if (!slug || slug.trim() !== slug) throw new Error('Invalid offline topic slug.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT ${fields} FROM topics t JOIN categories c ON c.slug = t.category_slug
         WHERE t.slug = ?`,
        [slug]
      );
      if (rows.length > 1) throw new Error('Duplicate offline topic slug.');
      return rows.length ? topicFromRow(rows[0]) : null;
    });
  }

  async topicsByIds(ids: string[]): Promise<Topic[]> {
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== 'string' || !id || id.trim() !== id) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error('Invalid offline topic IDs.');
    }
    if (!ids.length) return [];
    return this.database.transaction(async (db) => {
      const placeholders = ids.map(() => '?').join(', ');
      const rows = await db.query(
        `SELECT ${fields} FROM topics t JOIN categories c ON c.slug = t.category_slug
         WHERE t.id IN (${placeholders})`,
        ids
      );
      const topics = new Map(
        rows.map((row) => {
          const topic = topicFromRow(row);
          return [topic.id, topic] as const;
        })
      );
      return ids.flatMap((id) => {
        const topic = topics.get(id);
        return topic ? [topic] : [];
      });
    });
  }

  async category(slug: string): Promise<ContentCategory | null> {
    if (!slug || slug.trim() !== slug) throw new Error('Invalid offline category slug.');
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        'SELECT slug, name, description, order_index FROM categories WHERE slug = ?',
        [slug]
      );
      if (rows.length > 1) throw new Error('Duplicate offline category slug.');
      return rows.length ? categoryFromRow(rows[0]) : null;
    });
  }

  async topics(
    options: {
      cursor?: CatalogueCursor;
      category?: string;
      search?: string;
    } = {}
  ): Promise<{ topics: Topic[]; nextCursor: CatalogueCursor | null }> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.category) {
      conditions.push('t.category_slug = ?');
      values.push(options.category);
    }
    if (options.cursor) {
      integer(options.cursor.orderIndex);
      if (!options.cursor.id) throw new Error('Invalid offline topic cursor.');
      conditions.push('(t.order_index > ? OR (t.order_index = ? AND t.id > ?))');
      values.push(options.cursor.orderIndex, options.cursor.orderIndex, options.cursor.id);
    }
    const search = options.search?.trim().slice(0, 120);
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        `(t.question LIKE ? ESCAPE '\\' OR t.answer LIKE ? ESCAPE '\\'
          OR t.explanation LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
          OR t.catechism_text LIKE ? ESCAPE '\\' OR t.scripture_text LIKE ? ESCAPE '\\'
          OR t.scripture_reference LIKE ? ESCAPE '\\')`
      );
      values.push(...Array(7).fill(pattern));
    }

    return this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT ${fields} FROM topics t JOIN categories c ON c.slug = t.category_slug
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY t.order_index, t.id LIMIT 51`,
        values
      );
      const page = rows.slice(0, 50);
      const last = page.at(-1);
      return {
        topics: page.map(topicFromRow),
        nextCursor:
          rows.length > 50 && last
            ? { orderIndex: integer(last.order_index), id: text(last.id) }
            : null,
      };
    });
  }

  async categories(cursor?: CategoryCursor): Promise<{
    categories: ContentCategory[];
    nextCursor: CategoryCursor | null;
  }> {
    if (cursor) {
      integer(cursor.orderIndex);
      if (!cursor.slug) throw new Error('Invalid offline category cursor.');
    }
    return this.database.transaction(async (db) => {
      const rows = await db.query(
        `SELECT slug, name, description, order_index FROM categories
         ${cursor ? 'WHERE order_index > ? OR (order_index = ? AND slug > ?)' : ''}
         ORDER BY order_index, slug LIMIT 51`,
        cursor ? [cursor.orderIndex, cursor.orderIndex, cursor.slug] : []
      );
      const page = rows.slice(0, 50);
      const last = page.at(-1);
      return {
        categories: page.map(categoryFromRow),
        nextCursor:
          rows.length > 50 && last
            ? { orderIndex: integer(last.order_index), slug: text(last.slug) }
            : null,
      };
    });
  }
}
