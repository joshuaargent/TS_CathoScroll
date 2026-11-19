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
  const mergeEntities = <T extends { id?: string; slug?: string; impressions?: number; viewable_impressions?: number; served?: number; clicks?: number; active_duration_ms?: number; skips?: number; opens?: number }>(
    signedIn: T[], anonymousRows: T[], key: 'id' | 'slug'
  ) => signedIn.map((item) => {
    const match = anonymousRows.find((row) => row[key] === item[key]);
    return {
      ...item,
      anonymous_impressions: match?.impressions ?? 0,
      anonymous_viewable_impressions: match?.viewable_impressions ?? 0,
      anonymous_served: match?.served ?? 0,
      anonymous_clicks: match?.clicks ?? 0,
      anonymous_active_duration_ms: match?.active_duration_ms ?? 0,
      anonymous_skips: match?.skips ?? 0,
      anonymous_opens: match?.opens ?? 0,
    };
  });
  const mergedOverview = {
    ...(data as Record<string, unknown>),
    categories: mergeEntities((data as { categories: { slug: string }[] }).categories, anonymous.categories, 'slug'),
    topics: mergeEntities((data as { topics: { id: string }[] }).topics, anonymous.topics, 'id'),
    sponsors: mergeEntities((data as { sponsors: { id: string }[] }).sponsors, anonymous.sponsors, 'id'),
    comments: mergeEntities((data as { comments: { id: number }[] }).comments.map((item) => ({ ...item, id: String(item.id) })), anonymous.comments, 'id')
      .map((item) => ({ ...item, id: Number(item.id) })),
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
