import type { SupabaseClient } from '@supabase/supabase-js';
import { withNetworkTimeout } from './request-timeout';
import type {
  CatalogueCategoryRecord,
  CatalogueRefreshTransport,
  CatalogueTopicRecord,
} from './catalogue-refresh';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid catalogue server response.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid catalogue server response.');
  return value;
}

function order(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Invalid catalogue server response.');
  }
  return value;
}

function count(value: unknown): number {
  const result = text(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result) || BigInt(result) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid catalogue count from server.');
  }
  return Number(result);
}

export class SupabaseCatalogueTransport implements CatalogueRefreshTransport {
  constructor(private readonly client: SupabaseClient) {}

  async head(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const request = this.client.rpc('offline_catalogue_head');
    const { data, error } = await withNetworkTimeout(signal, async (requestSignal) =>
      request.abortSignal(requestSignal)
    );
    if (error)
      throw new Error(`Unable to check for topic updates: ${error.message}`, { cause: error });
    signal?.throwIfAborted();
    return text(record(data).revision);
  }

  async counts(
    signal?: AbortSignal
  ): Promise<{ revision: string; categories: number; topics: number }> {
    signal?.throwIfAborted();
    const request = this.client.rpc('offline_catalogue_counts');
    const { data, error } = await withNetworkTimeout(signal, async (requestSignal) =>
      request.abortSignal(requestSignal)
    );
    if (error) throw new Error(`Unable to check topic counts: ${error.message}`, { cause: error });
    signal?.throwIfAborted();
    const result = record(data);
    return {
      revision: text(result.revision),
      categories: count(result.categories),
      topics: count(result.topics),
    };
  }

  async categories(after: string | null, signal?: AbortSignal): Promise<CatalogueCategoryRecord[]> {
    signal?.throwIfAborted();
    let request = this.client
      .from('categories')
      .select('slug,name,description,order_index')
      .eq('is_published', true)
      .order('slug', { ascending: true })
      .limit(100);
    if (after !== null) request = request.gt('slug', after);
    const { data, error } = await withNetworkTimeout(signal, async (requestSignal) =>
      request.abortSignal(requestSignal)
    );
    if (error) throw new Error(`Unable to update categories: ${error.message}`, { cause: error });
    signal?.throwIfAborted();
    if (!Array.isArray(data)) throw new Error('Invalid category server response.');
    return data.map((value) => {
      const row = record(value);
      return {
        slug: text(row.slug),
        name: text(row.name),
        description: text(row.description),
        orderIndex: order(row.order_index),
      };
    });
  }

  async topics(after: string | null, signal?: AbortSignal): Promise<CatalogueTopicRecord[]> {
    signal?.throwIfAborted();
    let request = this.client
      .from('topics')
      .select(
        'id,slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(slug,is_published)'
      )
      .eq('is_published', true)
      .eq('category.is_published', true)
      .order('id', { ascending: true })
      .limit(100);
    if (after !== null) request = request.gt('id', after);
    const { data, error } = await withNetworkTimeout(signal, async (requestSignal) =>
      request.abortSignal(requestSignal)
    );
    if (error) throw new Error(`Unable to update topics: ${error.message}`, { cause: error });
    signal?.throwIfAborted();
    if (!Array.isArray(data)) throw new Error('Invalid topic server response.');
    return data.map((value) => {
      const row = record(value);
      const category = record(row.category);
      if (category.is_published !== true) throw new Error('A topic has an unpublished category.');
      const paragraphs = row.catechism_paragraphs;
      if (paragraphs !== null && !Array.isArray(paragraphs)) {
        throw new Error('Invalid catechism paragraphs from server.');
      }
      return {
        id: text(row.id),
        slug: text(row.slug),
        categorySlug: text(category.slug),
        orderIndex: order(row.order_index),
        question: text(row.question),
        answer: text(row.answer),
        explanation: text(row.explanation),
        catechismParagraphs: (paragraphs ?? []).map(text),
        catechismText: text(row.catechism_text),
        scriptureReference: text(row.scripture_reference),
        scriptureText: text(row.scripture_text),
      };
    });
  }
}
