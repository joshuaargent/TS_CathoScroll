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
  title: 'Topic Analytics',
  robots: {
    index: false,
    follow: false,
  },
};

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
}

export default async function TopicAnalyticsPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ period: undefined }),
  ]);
  const { adminClient, user } = await requireAdminPage(
    `/topic/${encodeURIComponent(slug)}/analytics`
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

  const { data: topic, error: topicError } = await adminClient
    .from('topics')
    .select('slug,question')
    .eq('slug', slug)
    .maybeSingle();

  if (topicError) {
    console.error('Unable to load topic analytics context:', topicError.message);
    throw new Error('Unable to load topic analytics.');
  }
  if (!topic) notFound();

  const period: AnalyticsPeriod = isAnalyticsPeriod(query.period) ? query.period : '30d';
  const { from, to } = getAnalyticsRange(period);
  const { data, error } = await adminClient.rpc('get_admin_content_analytics', {
    p_entity_type: 'topic',
    p_entity_id: topic.slug,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error) {
    console.error('Unable to load topic analytics:', error.message);
    throw new Error('Unable to load topic analytics.');
  }

  const analytics = parseContentAnalytics(data);
  if (!analytics) {
    console.error('Topic analytics returned an invalid aggregate payload.');
    throw new Error('Analytics returned an invalid response.');
  }

  return (
    <ContentAnalyticsDashboard
      analytics={analytics}
      title={topic.question}
      description="Performance and community engagement for this learning topic."
      backHref={`/topic/${encodeURIComponent(topic.slug)}`}
      backLabel="topic"
      analyticsHref={`/topic/${encodeURIComponent(topic.slug)}/analytics`}
      period={period}
    />
  );
}
