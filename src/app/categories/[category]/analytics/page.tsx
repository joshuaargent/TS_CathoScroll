import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ContentAnalyticsDashboard } from '@/components/admin/ContentAnalyticsDashboard';
import { requireAdminPage } from '@/lib/moderation/require-admin';
import { checkApiRateLimit } from '@/lib/security/api-rate-limit';
import {
  getAnalyticsRange,
  isAnalyticsPeriod,
  parseContentAnalytics,
  type AnalyticsPeriod,
} from '@/lib/analytics/content-analytics';

export const metadata: Metadata = {
  title: 'Category Analytics',
  robots: {
    index: false,
    follow: false,
  },
};

interface Props {
  params: Promise<{ category: string }>;
  searchParams?: Promise<{ period?: string }>;
}

export default async function CategoryAnalyticsPage({ params, searchParams }: Props) {
  const [{ category: slug }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ period: undefined }),
  ]);
  const { adminClient, user } = await requireAdminPage(
    `/categories/${encodeURIComponent(slug)}/analytics`
  );

  const rateLimit = await checkApiRateLimit({
    scope: 'admin:analytics:read',
    identifier: user.id,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    throw new Error(
      rateLimit.unavailable
        ? 'Analytics are temporarily unavailable. Please try again.'
        : 'Too many analytics requests. Please wait before refreshing.'
    );
  }

  const { data: category, error: categoryError } = await adminClient
    .from('categories')
    .select('slug,name,description')
    .eq('slug', slug)
    .maybeSingle();

  if (categoryError) {
    console.error('Unable to load category analytics context:', categoryError.message);
    throw new Error('Unable to load category analytics.');
  }
  if (!category) notFound();

  const period: AnalyticsPeriod = isAnalyticsPeriod(query.period) ? query.period : '30d';
  const { from, to } = getAnalyticsRange(period);
  const { data: anonymousData, error: anonymousError } = await adminClient.rpc('get_admin_anonymous_analytics', {
    p_actor_user_id: user.id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_entity_type: 'category',
    p_entity_id: category.slug,
  });
  if (anonymousError) {
    console.error('Unable to load anonymous category analytics:', anonymousError.message);
    throw new Error('Unable to load category analytics.');
  }
  const anonymousRaw = anonymousData as {
    totals?: Record<string, number>;
    series?: Record<string, unknown>[];
    topics?: Record<string, unknown>[];
  };
  const anonymousAnalytics = {
    totals: {
      topic_impressions: Number(anonymousRaw.totals?.topic_impressions ?? 0),
      topic_viewable_impressions: Number(anonymousRaw.totals?.topic_viewable_impressions ?? 0),
      topic_active_duration_ms: Number(anonymousRaw.totals?.topic_active_duration_ms ?? 0),
      topic_skips: Number(anonymousRaw.totals?.topic_skips ?? 0),
      topic_completions: Number(anonymousRaw.totals?.topic_completions ?? 0),
    },
    series: (anonymousRaw.series ?? []).map((row) => ({
      event_date: String(row.event_date ?? ''),
      topic_impressions: Number(row.topic_impressions ?? 0),
      topic_viewable_impressions: Number(row.topic_viewable_impressions ?? 0),
    })),
    topics: (anonymousRaw.topics ?? []).map((row) => ({
      slug: String(row.slug ?? ''),
      impressions: Number(row.impressions ?? 0),
      viewable_impressions: Number(row.viewable_impressions ?? 0),
    })),
  };

  const { data, error } = await adminClient.rpc('get_admin_content_analytics', {
    p_entity_type: 'category',
    p_entity_id: category.slug,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error) {
    console.error('Unable to load category analytics:', error.message);
    throw new Error('Unable to load category analytics.');
  }

  const analytics = parseContentAnalytics(data);
  if (!analytics) {
    console.error('Category analytics returned an invalid aggregate payload.');
    throw new Error('Analytics returned an invalid response.');
  }

  return (
    <ContentAnalyticsDashboard
      analytics={analytics}
      anonymousAnalytics={anonymousAnalytics}
      title={category.name}
      description={category.description || 'Performance and community engagement across this learning category.'}
      backHref={`/categories/${encodeURIComponent(category.slug)}`}
      backLabel="category"
      analyticsHref={`/categories/${encodeURIComponent(category.slug)}/analytics`}
      period={period}
    />
  );
}
