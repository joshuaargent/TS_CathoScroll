export type AnalyticsPeriod = '7d' | '30d' | '90d' | '180d';

export interface DailyContentAnalytics {
  date: string;
  impressions: number;
  viewable_impressions: number;
  unique_viewers: number;
  active_seconds: number;
}

export interface ContentAnalytics {
  entity_type: 'topic' | 'category';
  entity_id: string;
  range_start: string;
  range_end: string;
  first_retained_event_at: string | null;
  last_event_at: string | null;
  events: {
    impressions: number;
    viewable_impressions: number;
    unique_viewers: number;
    active_seconds: number;
    skips: number;
    average_slide_depth: number;
    completions: number;
    average_completion_percent: number;
    return_visits: number;
  };
  interactions: {
    period: {
      likes: number;
      bookmarks: number;
      comments: number;
      replies: number;
      comment_likes: number;
      completed_topics: number;
    };
    lifetime: {
      likes: number;
      bookmarks: number;
      comments: number;
      replies: number;
      comment_likes: number;
      completed_topics: number;
    };
  };
  category_content: {
    total_topics: number;
    published_topics: number;
    unpublished_topics: number;
  } | null;
  top_topics: {
    slug: string;
    question: string;
    impressions: number;
    viewable_impressions: number;
    likes: number;
    bookmarks: number;
    comments: number;
    replies: number;
    comment_likes: number;
    completed_topics: number;
  }[];
  series: DailyContentAnalytics[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseCountRecord<T extends string>(
  value: unknown,
  keys: readonly T[]
): Record<T, number> | null {
  if (!isRecord(value)) return null;
  const result = {} as Record<T, number>;
  for (const key of keys) {
    const count = value[key];
    if (!finiteNonNegative(count) || !Number.isSafeInteger(count)) return null;
    result[key] = count;
  }
  return result;
}

const eventKeys = [
  'impressions',
  'viewable_impressions',
  'unique_viewers',
  'active_seconds',
  'skips',
  'average_slide_depth',
  'completions',
  'average_completion_percent',
  'return_visits',
] as const;

const interactionKeys = [
  'likes',
  'bookmarks',
  'comments',
  'replies',
  'comment_likes',
  'completed_topics',
] as const;

export function parseContentAnalytics(value: unknown): ContentAnalytics | null {
  if (!isRecord(value) || !isRecord(value.events) || !isRecord(value.interactions)) return null;

  const events = value.events;
  const parsedEvents = {} as ContentAnalytics['events'];
  for (const key of eventKeys) {
    const metric = events[key];
    if (!finiteNonNegative(metric)) return null;
    parsedEvents[key] = metric;
  }

  const period = parseCountRecord(value.interactions.period, interactionKeys);
  const lifetime = parseCountRecord(value.interactions.lifetime, interactionKeys);
  if (!period || !lifetime) return null;

  let categoryContent: ContentAnalytics['category_content'] = null;
  if (value.category_content !== null) {
    const counts = parseCountRecord(value.category_content, [
      'total_topics',
      'published_topics',
      'unpublished_topics',
    ] as const);
    if (!counts) return null;
    categoryContent = counts;
  }

  if (!Array.isArray(value.top_topics) || value.top_topics.length > 5) return null;
  const topTopics: ContentAnalytics['top_topics'] = [];
  for (const item of value.top_topics) {
    if (
      !isRecord(item) ||
      typeof item.slug !== 'string' ||
      item.slug.length < 1 ||
      item.slug.length > 150 ||
      typeof item.question !== 'string' ||
      item.question.length < 1 ||
      item.question.length > 2000
    ) {
      return null;
    }
    const counts = parseCountRecord(item, [
      'impressions',
      'viewable_impressions',
      'likes',
      'bookmarks',
      'comments',
      'replies',
      'comment_likes',
      'completed_topics',
    ] as const);
    if (!counts) return null;
    topTopics.push({ slug: item.slug, question: item.question, ...counts });
  }

  if (
    (value.entity_type !== 'topic' && value.entity_type !== 'category') ||
    (value.entity_type === 'category' && categoryContent === null) ||
    (value.entity_type === 'topic' && (categoryContent !== null || topTopics.length > 0)) ||
    typeof value.entity_id !== 'string' ||
    !isIsoDate(value.range_start) ||
    !isIsoDate(value.range_end) ||
    !(value.first_retained_event_at === null || isIsoDate(value.first_retained_event_at)) ||
    !(value.last_event_at === null || isIsoDate(value.last_event_at)) ||
    !Array.isArray(value.series)
  ) {
    return null;
  }

  const series: DailyContentAnalytics[] = [];
  for (const item of value.series) {
    if (
      !isRecord(item) ||
      typeof item.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      !finiteNonNegative(item.impressions) ||
      !finiteNonNegative(item.viewable_impressions) ||
      !finiteNonNegative(item.unique_viewers) ||
      !finiteNonNegative(item.active_seconds)
    ) {
      return null;
    }
    series.push({
      date: item.date,
      impressions: item.impressions,
      viewable_impressions: item.viewable_impressions,
      unique_viewers: item.unique_viewers,
      active_seconds: item.active_seconds,
    });
  }

  return {
    entity_type: value.entity_type,
    entity_id: value.entity_id,
    range_start: value.range_start,
    range_end: value.range_end,
    first_retained_event_at: value.first_retained_event_at,
    last_event_at: value.last_event_at,
    events: parsedEvents,
    interactions: { period, lifetime },
    category_content: categoryContent,
    top_topics: topTopics,
    series,
  };
}

export function getAnalyticsRange(period: AnalyticsPeriod, now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 180;
  from.setUTCDate(from.getUTCDate() - days);
  return { from, to };
}

export function isAnalyticsPeriod(value: string | undefined): value is AnalyticsPeriod {
  return value === '7d' || value === '30d' || value === '90d' || value === '180d';
}
