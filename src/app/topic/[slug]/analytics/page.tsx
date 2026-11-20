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
  const { data: anonymousData, error: anonymousError } = await adminClient.rpc('get_admin_anonymous_analytics', {
    p_actor_user_id: user.id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_entity_type: 'topic',
    p_entity_id: topic.slug,
  });
  if (anonymousError) {
    console.error('Unable to load anonymous topic analytics:', anonymousError.message);
    throw new Error('Unable to load topic analytics.');
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
      anonymousAnalytics={anonymousAnalytics}
      title={topic.question}
      description="Performance and community engagement for this learning topic."
      backHref={`/topic/${encodeURIComponent(topic.slug)}`}
      backLabel="topic"
      analyticsHref={`/topic/${encodeURIComponent(topic.slug)}/analytics`}
      period={period}
    />
  );
}
