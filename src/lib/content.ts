import 'server-only';

import { unstable_cache } from 'next/cache';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { ContentCategory, Topic } from '@/types';

export const CONTENT_CACHE_TAG = 'published-content';
const contentCacheSeconds = 300;
const pageSize = 500;

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

const loadPublishedTopics = unstable_cache(
  async (): Promise<Topic[]> => {
    const supabase = createPublicContentClient();
    const topics: Topic[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('topics')
        .select(topicFields)
        .eq('is_published', true)
        .eq('category.is_published', true)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Unable to load topics: ${error.message}`);
      }

      topics.push(...((data ?? []) as unknown as DatabaseTopic[]).map(mapDatabaseTopic));

      if (!data || data.length < pageSize) {
        return topics;
      }
    }
  },
  ['published-content-topics-v1'],
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

export async function getPublishedTopics(): Promise<Topic[]> {
  return loadPublishedTopics();
}

export async function getPublishedTopicBySlug(slug: string): Promise<Topic | null> {
  return loadPublishedTopicBySlug(slug);
}

export async function getPublishedTopicsByIds(ids: string[]): Promise<Topic[]> {
  if (ids.length === 0) {
    return [];
  }

  // Restore caller order (for example, most recently bookmarked first) after
  // the cached rows return in database order.
  return loadPublishedTopicsByIds(ids);
}
