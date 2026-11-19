import type { Metadata } from 'next';

import { AdminAnalyticsHub } from '@/components/admin/AdminAnalyticsHub';
import { requireAdminPage } from '@/lib/moderation/require-admin';
import { checkApiRateLimit } from '@/lib/security/api-rate-limit';
import { getAnalyticsRange, isAnalyticsPeriod, type AnalyticsPeriod } from '@/lib/analytics/content-analytics';

export const metadata: Metadata = { title: 'Analytics', robots: { index: false, follow: false } };

interface Props { searchParams?: Promise<{ period?: string; section?: string }> }

export default async function AdminAnalyticsPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const { adminClient, user } = await requireAdminPage('/admin/analytics');
  const rateLimit = await checkApiRateLimit({ scope: 'admin:analytics:read', identifier: user.id, limit: 60, windowSeconds: 60 });
  if (!rateLimit.allowed) throw new Error(rateLimit.unavailable ? 'Analytics are temporarily unavailable. Please try again.' : 'Too many analytics requests. Please wait before refreshing.');
  const period: AnalyticsPeriod = isAnalyticsPeriod(query.period) ? query.period : '30d';
  const { from, to } = getAnalyticsRange(period);
  const previousDuration = to.getTime() - from.getTime();
  const previousFrom = new Date(from.getTime() - previousDuration);
  const [{ data, error }, { data: seriesData, error: seriesError }, { data: deepDiveData, error: deepDiveError }, { data: comparisonData, error: comparisonError }, { data: anonymousData, error: anonymousError }, { data: previousAnonymousData, error: previousAnonymousError }] = await Promise.all([
    adminClient.rpc('get_admin_analytics_overview', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    adminClient.rpc('get_admin_analytics_series', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    adminClient.rpc('get_admin_analytics_deep_dive', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    adminClient.rpc('get_admin_analytics_overview', { p_actor_user_id: user.id, p_from: previousFrom.toISOString(), p_to: from.toISOString() }),
    adminClient.rpc('get_admin_anonymous_analytics', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString(), p_entity_type: 'all', p_entity_id: null }),
    adminClient.rpc('get_admin_anonymous_analytics', { p_actor_user_id: user.id, p_from: previousFrom.toISOString(), p_to: from.toISOString(), p_entity_type: 'all', p_entity_id: null }),
  ]);
  if (error || seriesError || deepDiveError || comparisonError || anonymousError || previousAnonymousError || !anonymousData || !previousAnonymousData || !data || typeof data !== 'object' || !Array.isArray(seriesData) || !deepDiveData || typeof deepDiveData !== 'object' || !comparisonData || typeof comparisonData !== 'object') {
    console.error('Unable to load admin analytics overview:', error?.message, seriesError?.message, deepDiveError?.message, comparisonError?.message, anonymousError?.message, previousAnonymousError?.message);
    throw new Error('Unable to load analytics.');
  }

  const anonymous = anonymousData as {
    totals: Record<string, number>;
    series: Record<string, number | string>[];
    categories: { slug: string; impressions: number; viewable_impressions: number }[];
    topics: { id: string; impressions: number; viewable_impressions: number; active_duration_ms: number }[];
    sponsors: { id: string; served: number; viewable_impressions: number; clicks: number }[];
    comments: { id: string; impressions: number; viewable_impressions: number; active_duration_ms: number; skips: number; opens: number }[];
  };
  const previousAnonymous = previousAnonymousData as { totals: Record<string, number> };
  const mergeEntities = (
    signedIn: Record<string, unknown>[],
    anonymousRows: Record<string, unknown>[],
    key: 'id' | 'slug'
  ) => {
    const signedKeys = new Set(signedIn.map((item) => String(item[key])));
    const attachAnonymous = (item: Record<string, unknown>) => ({
      anonymous_impressions: Number(item.impressions ?? 0),
      anonymous_viewable_impressions: Number(item.viewable_impressions ?? 0),
      anonymous_served: Number(item.served ?? 0),
      anonymous_clicks: Number(item.clicks ?? 0),
      anonymous_active_duration_ms: Number(item.active_duration_ms ?? 0),
      anonymous_skips: Number(item.skips ?? 0),
      anonymous_opens: Number(item.opens ?? 0),
    });
    const merged = [
      ...signedIn.map((item) => {
        const match = anonymousRows.find((row) => String(row[key]) === String(item[key]));
        return { ...item, ...attachAnonymous(match ?? {}) };
      }),
      ...anonymousRows.filter((item) => !signedKeys.has(String(item[key]))).map((item) => ({
        ...item,
        impressions: 0,
        viewable_impressions: 0,
        active_duration_ms: 0,
        skips: 0,
        opens: 0,
        served: 0,
        clicks: 0,
        likes: 0,
        replies: 0,
        topic_count: item.topic_count ?? 0,
        status: '—',
        campaign_count: 0,
        topic_question: null,
        topic_id: '',
        created_at: '',
        ...attachAnonymous(item),
      })),
    ];
    return merged.sort((left, right) =>
      Number(right.served ?? right.impressions ?? 0) + Number(right.anonymous_served ?? right.anonymous_impressions ?? 0) -
      Number(left.served ?? left.impressions ?? 0) - Number(left.anonymous_served ?? left.anonymous_impressions ?? 0)
    );
  };
  const mergedOverview = {
    ...(data as Record<string, unknown>),
    categories: mergeEntities(
      (data as { categories: Record<string, unknown>[] }).categories,
      anonymous.categories as unknown as Record<string, unknown>[],
      'slug'
    ),
    topics: mergeEntities(
      (data as { topics: Record<string, unknown>[] }).topics,
      anonymous.topics as unknown as Record<string, unknown>[],
      'id'
    ).slice(0, 20),
    sponsors: mergeEntities(
      (data as { sponsors: Record<string, unknown>[] }).sponsors,
      anonymous.sponsors as unknown as Record<string, unknown>[],
      'id'
    ),
    comments: mergeEntities(
      (data as { comments: Record<string, unknown>[] }).comments.map((item) => ({ ...item, id: String(item.id) })),
      anonymous.comments as unknown as Record<string, unknown>[],
      'id'
    ).slice(0, 20).map((item) => ({ ...item, id: Number(item.id) })),
  };
  const mergedSeries = (seriesData as Record<string, unknown>[]).map((day) => {
    const match = anonymous.series.find((row) => row.event_date === day.event_date);
    return { ...day, ...Object.fromEntries(Object.entries(match ?? {}).filter(([key]) => key !== 'event_date').map(([key, value]) => ['anonymous_' + key, value])) };
  });
  const mergedTotals = {
    ...(data as { totals: Record<string, number> }).totals,
    anonymous_topic_impressions: anonymous.totals.topic_impressions ?? 0,
    anonymous_topic_viewable_impressions: anonymous.totals.topic_viewable_impressions ?? 0,
    anonymous_topic_active_duration_ms: anonymous.totals.topic_active_duration_ms ?? 0,
    anonymous_topic_skips: anonymous.totals.topic_skips ?? 0,
    anonymous_topic_completions: anonymous.totals.topic_completions ?? 0,
    anonymous_sponsor_served: anonymous.totals.sponsor_served ?? 0,
    anonymous_sponsor_viewable_impressions: anonymous.totals.sponsor_viewable_impressions ?? 0,
    anonymous_sponsor_clicks: anonymous.totals.sponsor_clicks ?? 0,
    anonymous_comment_card_impressions: anonymous.totals.comment_card_impressions ?? 0,
    anonymous_comment_card_viewable_impressions: anonymous.totals.comment_card_viewable_impressions ?? 0,
    anonymous_comment_card_active_duration_ms: anonymous.totals.comment_card_active_duration_ms ?? 0,
    anonymous_comment_card_skips: anonymous.totals.comment_card_skips ?? 0,
    anonymous_comment_card_opens: anonymous.totals.comment_card_opens ?? 0,
  };
  const mergedCurrent = { ...mergedOverview, totals: mergedTotals };
  const previousTotals = (comparisonData as { totals: Record<string, number> }).totals;
  const mergedPrevious = {
    ...(comparisonData as Record<string, unknown>),
    totals: {
      ...previousTotals,
      anonymous_topic_impressions: previousAnonymous.totals.topic_impressions ?? 0,
      anonymous_sponsor_served: previousAnonymous.totals.sponsor_served ?? 0,
      anonymous_comment_card_impressions: previousAnonymous.totals.comment_card_impressions ?? 0,
    },
  };

  return <AdminAnalyticsHub overview={mergedCurrent as Parameters<typeof AdminAnalyticsHub>[0]['overview']}
    series={mergedSeries as Parameters<typeof AdminAnalyticsHub>[0]['series']} period={period}
    section={query.section && ['overview','categories','topics','sponsors','comments'].includes(query.section) ? query.section : 'overview'}
    deepDive={deepDiveData as Parameters<typeof AdminAnalyticsHub>[0]['deepDive']}
    comparison={mergedPrevious as Parameters<typeof AdminAnalyticsHub>[0]['overview']} />;
}
