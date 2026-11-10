import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ContentCategory, Topic } from '@/types';

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

export async function getPublishedCategories(): Promise<ContentCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('slug,name,description,order_index')
    .eq('is_published', true)
    .order('order_index', { ascending: true });

  if (error) {
    throw new Error(`Unable to load categories: ${error.message}`);
  }

  return ((data ?? []) as DatabaseCategory[]).map((category) => ({
    slug: category.slug,
    name: category.name,
    description: category.description,
    orderIndex: category.order_index,
  }));
}

export async function getPublishedTopics(): Promise<Topic[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('topics')
    .select(topicFields)
    .eq('is_published', true)
    .eq('category.is_published', true)
    .order('order_index', { ascending: true });

  if (error) {
    throw new Error(`Unable to load topics: ${error.message}`);
  }

  return ((data ?? []) as unknown as DatabaseTopic[]).map(mapDatabaseTopic);
}

export async function getPublishedTopicBySlug(slug: string): Promise<Topic | null> {
  const supabase = await createClient();
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
}

export async function getPublishedTopicsByIds(ids: string[]): Promise<Topic[]> {
  if (ids.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const topicById = new Map<string, Topic>();
  const batchSize = 100;

  // Chunk large bookmark collections to keep PostgREST URL/query sizes bounded.
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const { data, error } = await supabase
      .from('topics')
      .select(topicFields)
      .in('id', batch)
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

  // Restore caller order (for example, most recently bookmarked first) after
  // the database returns the matching topic rows.
  return ids.flatMap((id) => {
    const topic = topicById.get(id);
    return topic ? [topic] : [];
  });
}
