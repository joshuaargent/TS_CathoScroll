import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { CONTENT_CACHE_TAG } from '@/lib/content';
import {
  createServiceRoleClient,
  getAdminSessionFromRequest,
  isSameOriginOrNativeRequest,
  nativeApiCorsHeaders,
} from '@/lib/supabase/admin';
import { readBoundedJson } from '@/lib/http/read-json';
import { checkApiRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

type CategoryInput = Record<string, unknown> & {
  kind: 'category';
  slug: string;
  name: string;
  description: string;
  orderIndex: number;
  isPublished: boolean;
};

type TopicInput = Record<string, unknown> & {
  kind: 'topic';
  id?: string;
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
  isPublished: boolean;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isText(value: unknown, maximum: number, allowEmpty = true): value is string {
  return (
    typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
  );
}

function isOrderIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000;
}

function isCategoryInput(value: Record<string, unknown>): value is CategoryInput {
  return (
    value.kind === 'category' &&
    typeof value.slug === 'string' &&
    value.slug.length <= 100 &&
    slugPattern.test(value.slug) &&
    isText(value.name, 100, false) &&
    isText(value.description, 1000) &&
    isOrderIndex(value.orderIndex) &&
    typeof value.isPublished === 'boolean'
  );
}

function isTopicInput(value: Record<string, unknown>): value is TopicInput {
  return (
    value.kind === 'topic' &&
    (value.id === undefined || (typeof value.id === 'string' && value.id.length <= 100)) &&
    typeof value.slug === 'string' &&
    value.slug.length <= 100 &&
    slugPattern.test(value.slug) &&
    typeof value.categorySlug === 'string' &&
    value.categorySlug.length <= 100 &&
    slugPattern.test(value.categorySlug) &&
    isOrderIndex(value.orderIndex) &&
    isText(value.question, 500, false) &&
    isText(value.answer, 20_000, false) &&
    isText(value.explanation, 30_000) &&
    Array.isArray(value.catechismParagraphs) &&
    value.catechismParagraphs.length <= 100 &&
    value.catechismParagraphs.every((paragraph) => isText(paragraph, 100, false)) &&
    isText(value.catechismText, 30_000) &&
    isText(value.scriptureReference, 500) &&
    isText(value.scriptureText, 20_000) &&
    typeof value.isPublished === 'boolean'
  );
}

function categoryRow(input: CategoryInput) {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    order_index: input.orderIndex,
    is_published: input.isPublished,
  };
}

function topicRow(input: TopicInput) {
  return {
    slug: input.slug,
    category_slug: input.categorySlug,
    order_index: input.orderIndex,
    question: input.question.trim(),
    answer: input.answer.trim(),
    explanation: input.explanation.trim(),
    catechism_paragraphs: input.catechismParagraphs.map((paragraph) => paragraph.trim()),
    catechism_text: input.catechismText.trim(),
    scripture_reference: input.scriptureReference.trim(),
    scripture_text: input.scriptureText.trim(),
    is_published: input.isPublished,
  };
}

async function authorize(request: Request) {
  if (!isSameOriginOrNativeRequest(request)) {
    return { response: respond(request, { error: 'Forbidden' }, { status: 403 }) };
  }

  const { user, isAdmin, error } = await getAdminSessionFromRequest(request);

  if (!user) {
    return { response: respond(request, { error: 'Authentication required' }, { status: 401 }) };
  }
  if (error) {
    console.error('Unable to verify content editor access:', error.message);
    return {
      response: respond(request, { error: 'Unable to verify admin access' }, { status: 500 }),
    };
  }
  if (!isAdmin) {
    return { response: respond(request, { error: 'Forbidden' }, { status: 403 }) };
  }

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:content',
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return {
      response: respond(
        request,
        { error: rateLimit.unavailable ? 'Content editor is temporarily unavailable' : 'Too many content-editor requests. Please wait.' },
        { status: rateLimit.unavailable ? 503 : 429, headers: rateLimitResponseHeaders(rateLimit.retryAfterSeconds) }
      ),
    };
  }

  try {
    return { adminClient: createServiceRoleClient() };
  } catch (error) {
    console.error('Content editor is not configured:', error);
    return {
      response: respond(request, { error: 'Content editor is not configured' }, { status: 500 }),
    };
  }
}

async function readInput(request: Request): Promise<unknown | NextResponse> {
  const parsed = await readBoundedJson(request, 128 * 1024);
  if (!parsed.ok) {
    return respond(request, { error: parsed.error }, { status: parsed.status });
  }
  return parsed.value;
}

function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

function handleDatabaseError(request: Request, message: string, error: { code?: string; message: string }) {
  if (error.code === '23505') {
    return respond(request, { error: 'A record with that slug already exists.' }, { status: 409 });
  }
  if (error.code === '23503') {
    return respond(request, 
      { error: 'Select an existing category for this topic.' },
      { status: 400 }
    );
  }

  console.error(message, error.message);
  return respond(request, { error: 'Unable to save content.' }, { status: 500 });
}

function invalidateContent() {
  revalidateTag(CONTENT_CACHE_TAG, { expire: 0 });
}

function respond(request: Request, body: unknown, init?: ResponseInit) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

async function loadAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query(offset, offset + 499);
    if (error) throw new Error(`Unable to load admin ${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if ('response' in authorization) return authorization.response;

  try {
    const [categories, topics] = await Promise.all([
      loadAllRows(
        (from, to) => authorization.adminClient
          .from('categories')
          .select('slug,name,description,order_index,is_published')
          .order('order_index', { ascending: true })
          .order('slug', { ascending: true })
          .range(from, to),
        'categories'
      ),
      loadAllRows(
        (from, to) => authorization.adminClient
          .from('topics')
          .select('id,slug,category_slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,is_published')
          .order('order_index', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
        'topics'
      ),
    ]);
    return respond(request, { categories, topics });
  } catch (error) {
    console.error('Unable to load admin content:', error);
    return respond(request, { error: 'Unable to load admin content.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if ('response' in authorization) return authorization.response;

  const input = await readInput(request);
  if (isResponse(input)) return input;
  if (!isRecord(input)) {
    return respond(request, { error: 'Invalid content data.' }, { status: 400 });
  }

  if (isCategoryInput(input)) {
    const { error } = await authorization.adminClient.from('categories').insert({
      slug: input.slug,
      ...categoryRow(input),
    });
    if (error) return handleDatabaseError(request, 'Unable to create category:', error);
  } else if (isTopicInput(input)) {
    const { data: category, error: categoryError } = await authorization.adminClient
      .from('categories')
      .select('slug')
      .eq('slug', input.categorySlug)
      .maybeSingle();

    if (categoryError)
      return handleDatabaseError(request, 'Unable to verify topic category:', categoryError);
    if (!category) {
      return respond(request, 
        { error: 'Select an existing category for this topic.' },
        { status: 400 }
      );
    }

    const { error } = await authorization.adminClient.from('topics').insert({
      id: crypto.randomUUID(),
      ...topicRow(input),
    });
    if (error) return handleDatabaseError(request, 'Unable to create topic:', error);
  } else {
    return respond(request, { error: 'Invalid content data.' }, { status: 400 });
  }

  invalidateContent();
  return respond(request, { success: true });
}

export async function PATCH(request: Request) {
  const authorization = await authorize(request);
  if ('response' in authorization) return authorization.response;

  const input = await readInput(request);
  if (isResponse(input)) return input;
  if (!isRecord(input)) {
    return respond(request, { error: 'Invalid content data.' }, { status: 400 });
  }

  if (isCategoryInput(input)) {
    const { data, error } = await authorization.adminClient
      .from('categories')
      .update(categoryRow(input))
      .eq('slug', input.slug)
      .select('slug')
      .maybeSingle();
    if (error) return handleDatabaseError(request, 'Unable to update category:', error);
    if (!data) return respond(request, { error: 'Category not found.' }, { status: 404 });
  } else if (isTopicInput(input) && input.id) {
    const { data: existingTopic, error: existingTopicError } = await authorization.adminClient
      .from('topics')
      .select('slug')
      .eq('id', input.id)
      .maybeSingle();

    if (existingTopicError) {
      return handleDatabaseError(request, 'Unable to verify topic before update:', existingTopicError);
    }
    if (!existingTopic) return respond(request, { error: 'Topic not found.' }, { status: 404 });
    if (existingTopic.slug !== input.slug) {
      return respond(request, 
        { error: 'A topic URL slug cannot be changed after creation.' },
        { status: 400 }
      );
    }

    const { data, error } = await authorization.adminClient
      .from('topics')
      .update(topicRow(input))
      .eq('id', input.id)
      .select('id')
      .maybeSingle();
    if (error) return handleDatabaseError(request, 'Unable to update topic:', error);
    if (!data) return respond(request, { error: 'Topic not found.' }, { status: 404 });
  } else {
    return respond(request, { error: 'Invalid content data.' }, { status: 400 });
  }

  invalidateContent();
  return respond(request, { success: true });
}
