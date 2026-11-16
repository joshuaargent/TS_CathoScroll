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
      title={category.name}
      description={category.description || 'Performance and community engagement across this learning category.'}
      backHref={`/categories/${encodeURIComponent(category.slug)}`}
      backLabel="category"
      analyticsHref={`/categories/${encodeURIComponent(category.slug)}/analytics`}
      period={period}
    />
  );
}
