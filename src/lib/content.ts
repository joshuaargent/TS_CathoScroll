import 'server-only';

import { unstable_cache } from 'next/cache';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { ContentCategory, Topic } from '@/types';

export const CONTENT_CACHE_TAG = 'published-content';
const contentCacheSeconds = 300;
const pageSize = 50;

interface DatabaseCategory {
  slug: string;
  name: string;
  description: string;
  order_index: number;
}

interface DatabaseTopic {
  id: string;
  slug: string;
  order_index: number;
  question: string;
  answer: string;
  explanation: string;
  catechism_paragraphs: string[];
  catechism_text: string;
  scripture_reference: string;
  scripture_text: string;
  category: Pick<DatabaseCategory, 'slug' | 'name'> & { is_published: boolean };
}

const topicFields =
  'id,slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(slug,name,is_published)';

function createPublicContentClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Public Supabase configuration is missing.');
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function mapDatabaseTopic(row: DatabaseTopic): Topic {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category.name,
    question: row.question,
    answer: row.answer,
    explanation: row.explanation,
    catechism: {
      paragraphs: row.catechism_paragraphs ?? [],
      text: row.catechism_text,
    },
    scripture: {
      reference: row.scripture_reference,
      text: row.scripture_text,
    },
  };
}

const loadPublishedCategories = unstable_cache(
  async (): Promise<ContentCategory[]> => {
    const supabase = createPublicContentClient();
    const categories: ContentCategory[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('categories')
        .select('slug,name,description,order_index')
        .eq('is_published', true)
        .order('order_index', { ascending: true })
        .order('slug', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Unable to load categories: ${error.message}`);
      }

      categories.push(
        ...((data ?? []) as DatabaseCategory[]).map((category) => ({
          slug: category.slug,
          name: category.name,
          description: category.description,
          orderIndex: category.order_index,
        }))
      );

      if (!data || data.length < pageSize) {
        return categories;
      }
    }
  },
  ['published-content-categories-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

const loadPublishedTopicBySlug = unstable_cache(
  async (slug: string): Promise<Topic | null> => {
    const supabase = createPublicContentClient();
    const { data, error } = await supabase
      .from('topics')
      .select(topicFields)
      .eq('slug', slug)
      .eq('is_published', true)
      .eq('category.is_published', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load topic: ${error.message}`);
    }

    return data ? mapDatabaseTopic(data as unknown as DatabaseTopic) : null;
  },
  ['published-content-topic-by-slug-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

const loadPublishedTopicsByIds = unstable_cache(
  async (ids: string[]): Promise<Topic[]> => {
    const supabase = createPublicContentClient();
    const topicById = new Map<string, Topic>();
    const batchSize = 100;

    // Keep ID filters bounded while avoiding a full-catalog load for profiles and bookmarks.
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const { data, error } = await supabase
        .from('topics')
        .select(topicFields)
        .in('id', ids.slice(offset, offset + batchSize))
        .eq('is_published', true)
        .eq('category.is_published', true);

      if (error) {
        throw new Error(`Unable to load topics: ${error.message}`);
      }

      for (const row of (data ?? []) as unknown as DatabaseTopic[]) {
        const topic = mapDatabaseTopic(row);
        topicById.set(topic.id, topic);
      }
    }

    return ids.flatMap((id) => {
      const topic = topicById.get(id);
      return topic ? [topic] : [];
    });
  },
  ['published-content-topics-by-id-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

export async function getPublishedCategories(): Promise<ContentCategory[]> {
  return loadPublishedCategories();
}

export interface TopicPageCursor {
  orderIndex: number;
  id: string;
}

const loadPublishedTopicPage = unstable_cache(
  async (
    cursor?: TopicPageCursor,
    categorySlug?: string,
    requestedLimit = pageSize
  ): Promise<{ topics: Topic[]; nextCursor: TopicPageCursor | null }> => {
    const limit = Math.min(Math.max(requestedLimit, 1), 50);
    const supabase = createPublicContentClient();
    let query = supabase
      .from('topics')
      .select(topicFields)
      .eq('is_published', true)
      .eq('category.is_published', true)
      .order('order_index', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (categorySlug) {
      query = query.eq('category.slug', categorySlug);
    }

    if (cursor) {
      const { orderIndex, id } = cursor;
      query = query.or(
        `order_index.gt.${orderIndex},and(order_index.eq.${orderIndex},id.gt.${id})`
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Unable to load topic page: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as DatabaseTopic[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);

    return {
      topics: pageRows.map(mapDatabaseTopic),
      nextCursor: hasMore && last ? { orderIndex: last.order_index, id: last.id } : null,
    };
  },
  ['published-content-topic-page-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

export async function getPublishedTopicPage(
  options: {
    cursor?: TopicPageCursor;
    categorySlug?: string;
    limit?: number;
  } = {}
): Promise<{ topics: Topic[]; nextCursor: TopicPageCursor | null }> {
  return loadPublishedTopicPage(options.cursor, options.categorySlug, options.limit ?? pageSize);
}

export const getRecentlyCreatedPublishedTopics = unstable_cache(
  async (): Promise<Topic[]> => {
    const supabase = createPublicContentClient();
    const { data, error } = await supabase
      .from('topics')
      .select(topicFields)
      .eq('is_published', true)
      .eq('category.is_published', true)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Unable to load recent topics: ${error.message}`);
    }

    return ((data ?? []) as unknown as DatabaseTopic[]).map(mapDatabaseTopic);
  },
  ['published-content-recent-topics-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

export async function getPublishedTopicRange(offset: number, limit = 1000): Promise<Topic[]> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 40_000);
  const supabase = createPublicContentClient();
  const topics: Topic[] = [];

  for (let loaded = 0; loaded < safeLimit; loaded += 1000) {
    const chunkLimit = Math.min(1000, safeLimit - loaded);
    const { data, error } = await supabase
      .from('topics')
      .select(topicFields)
      .eq('is_published', true)
      .eq('category.is_published', true)
      .order('order_index', { ascending: true })
      .order('id', { ascending: true })
      .range(safeOffset + loaded, safeOffset + loaded + chunkLimit - 1);

    if (error) {
      throw new Error(`Unable to load topic range: ${error.message}`);
    }

    topics.push(...((data ?? []) as unknown as DatabaseTopic[]).map(mapDatabaseTopic));
    if (!data || data.length < chunkLimit) break;
  }

  return topics;
}

export async function getPublicProfileCount(): Promise<number> {
  const supabase = createPublicContentClient();
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('username', 'is', null);

  if (error) {
    throw new Error(`Unable to count public profiles: ${error.message}`);
  }

  return count ?? 0;
}

export async function getPublicProfileRange(offset: number, limit = 1000): Promise<string[]> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 40_000);
  const supabase = createPublicContentClient();
  const usernames: string[] = [];

  for (let loaded = 0; loaded < safeLimit; loaded += 1000) {
    const chunkLimit = Math.min(1000, safeLimit - loaded);
    const { data, error } = await supabase
      .from('profiles')
      .select('username')
      .not('username', 'is', null)
      .order('username', { ascending: true })
      .range(safeOffset + loaded, safeOffset + loaded + chunkLimit - 1);

    if (error) {
      throw new Error(`Unable to load public profiles: ${error.message}`);
    }

    usernames.push(
      ...(data ?? []).flatMap((profile) => (profile.username ? [profile.username] : []))
    );
    if (!data || data.length < chunkLimit) break;
  }

  return usernames;
}

const loadPublishedTopicCount = unstable_cache(
  async (categorySlug?: string): Promise<number> => {
    const supabase = createPublicContentClient();
    let query = supabase
      .from('topics')
      .select('id,category:categories!inner(slug,is_published)', {
        count: 'exact',
        head: true,
      })
      .eq('is_published', true)
      .eq('category.is_published', true);

    if (categorySlug) {
      query = query.eq('category.slug', categorySlug);
    }

    const { count, error } = await query;
    if (error) {
      throw new Error(`Unable to count published topics: ${error.message}`);
    }

    return count ?? 0;
  },
  ['published-content-topic-count-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

export async function getPublishedTopicCount(categorySlug?: string): Promise<number> {
  return loadPublishedTopicCount(categorySlug);
}

export interface DatabaseTopicSearchResult extends Omit<DatabaseTopic, 'category'> {
  category_slug: string;
  category_name: string;
  search_score: number;
}

export async function searchPublishedTopics(
  query: string,
  limit = 30
): Promise<Array<{ topic: Topic; score: number }>> {
  const normalizedQuery = query.trim().slice(0, 120);
  if (!normalizedQuery) {
    return [];
  }

  const supabase = createPublicContentClient();
  const { data, error } = await supabase.rpc('search_published_topics', {
    search_query: normalizedQuery,
    result_limit: Math.min(Math.max(limit, 1), 50),
  });

  if (error) {
    throw new Error(`Unable to search topics: ${error.message}`);
  }

  return ((data ?? []) as DatabaseTopicSearchResult[]).map((row) => ({
    topic: {
      id: row.id,
      slug: row.slug,
      category: row.category_name,
      question: row.question,
      answer: row.answer,
      explanation: row.explanation,
      catechism: {
        paragraphs: row.catechism_paragraphs ?? [],
        text: row.catechism_text,
      },
      scripture: {
        reference: row.scripture_reference,
        text: row.scripture_text,
      },
    },
    score: row.search_score,
  }));
}

export async function getPublishedTopicBySlug(slug: string): Promise<Topic | null> {
  return loadPublishedTopicBySlug(slug);
}

export interface PublishedTopicContext {
  topic: Topic;
  topicNumber: number;
  topicCount: number;
  previousTopic: Topic | null;
  nextTopic: Topic | null;
  relatedTopics: Topic[];
}

const loadPublishedTopicContext = unstable_cache(
  async (slug: string): Promise<PublishedTopicContext | null> => {
    const supabase = createPublicContentClient();
    const { data: row, error: topicError } = await supabase
      .from('topics')
      .select(topicFields)
      .eq('slug', slug)
      .eq('is_published', true)
      .eq('category.is_published', true)
      .maybeSingle();

    if (topicError) {
      throw new Error(`Unable to load topic context: ${topicError.message}`);
    }
    if (!row) {
      return null;
    }

    const topicRow = row as unknown as DatabaseTopic;
    const cursorFilter = `order_index.eq.${topicRow.order_index},id.lt.${topicRow.id}`;
    const afterFilter = `order_index.eq.${topicRow.order_index},id.gt.${topicRow.id}`;
    const [
      { data: previousRows, error: previousError },
      { data: nextRows, error: nextError },
      countResult,
      relatedResult,
    ] = await Promise.all([
      supabase
        .from('topics')
        .select(topicFields)
        .eq('is_published', true)
        .eq('category.is_published', true)
        .or(`order_index.lt.${topicRow.order_index},and(${cursorFilter})`)
        .order('order_index', { ascending: false })
        .order('id', { ascending: false })
        .limit(1),
      supabase
        .from('topics')
        .select(topicFields)
        .eq('is_published', true)
        .eq('category.is_published', true)
        .or(`order_index.gt.${topicRow.order_index},and(${afterFilter})`)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .limit(1),
      supabase
        .from('topics')
        .select('id,category:categories!inner(slug,is_published)', {
          count: 'exact',
          head: true,
        })
        .eq('is_published', true)
        .eq('category.is_published', true)
        .or(`order_index.lt.${topicRow.order_index},and(${cursorFilter})`),
      supabase
        .from('topics')
        .select(topicFields)
        .eq('is_published', true)
        .eq('category.is_published', true)
        .eq('category.slug', topicRow.category.slug)
        .neq('id', topicRow.id)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .limit(4),
    ]);

    if (previousError || nextError || countResult.error || relatedResult.error) {
      const error = previousError ?? nextError ?? countResult.error ?? relatedResult.error;
      throw new Error(`Unable to load topic navigation: ${error?.message}`);
    }

    const { count: topicCount, error: totalCountError } = await supabase
      .from('topics')
      .select('id,category:categories!inner(slug,is_published)', {
        count: 'exact',
        head: true,
      })
      .eq('is_published', true)
      .eq('category.is_published', true);
    if (totalCountError) {
      throw new Error(`Unable to count published topics: ${totalCountError.message}`);
    }

    return {
      topic: mapDatabaseTopic(topicRow),
      topicNumber: (countResult.count ?? 0) + 1,
      topicCount: topicCount ?? 0,
      previousTopic: previousRows?.[0]
        ? mapDatabaseTopic(previousRows[0] as unknown as DatabaseTopic)
        : null,
      nextTopic: nextRows?.[0] ? mapDatabaseTopic(nextRows[0] as unknown as DatabaseTopic) : null,
      relatedTopics: ((relatedResult.data ?? []) as unknown as DatabaseTopic[]).map(
        mapDatabaseTopic
      ),
    };
  },
  ['published-content-topic-context-v1'],
  { revalidate: contentCacheSeconds, tags: [CONTENT_CACHE_TAG] }
);

export async function getPublishedTopicContext(slug: string) {
  return loadPublishedTopicContext(slug);
}

export async function getPublishedTopicsByIds(ids: string[]): Promise<Topic[]> {
  if (ids.length === 0) {
    return [];
  }

  // Restore caller order (for example, most recently bookmarked first) after
  // the cached rows return in database order.
  return loadPublishedTopicsByIds(ids);
}
