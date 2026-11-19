import type { Metadata } from 'next';

import { AdminAnalyticsHub } from '@/components/admin/AdminAnalyticsHub';
import { requireAdminPage } from '@/lib/moderation/require-admin';
import { checkApiRateLimit } from '@/lib/security/api-rate-limit';
import { getAnalyticsRange, isAnalyticsPeriod, type AnalyticsPeriod } from '@/lib/analytics/content-analytics';

export const metadata: Metadata = { title: 'Analytics', robots: { index: false, follow: false } };

interface Props { searchParams?: Promise<{ period?: string; section?: string }> }

export default async function AdminAnalyticsPage({ searchParams }: Props) {
  const query = await (searchParams ?? Promise.resolve({}));
  const { adminClient, user } = await requireAdminPage('/admin/analytics');
  const rateLimit = await checkApiRateLimit({ scope: 'admin:analytics:read', identifier: user.id, limit: 60, windowSeconds: 60 });
  if (!rateLimit.allowed) throw new Error(rateLimit.unavailable ? 'Analytics are temporarily unavailable. Please try again.' : 'Too many analytics requests. Please wait before refreshing.');
  const period: AnalyticsPeriod = isAnalyticsPeriod(query.period) ? query.period : '30d';
  const { from, to } = getAnalyticsRange(period);
  const [{ data, error }, { data: seriesData, error: seriesError }] = await Promise.all([
    adminClient.rpc('get_admin_analytics_overview', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    adminClient.rpc('get_admin_analytics_series', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString() }),
  ]);
  if (error || seriesError || !data || typeof data !== 'object' || !Array.isArray(seriesData)) {
    console.error('Unable to load admin analytics overview:', error?.message, seriesError?.message);
    throw new Error('Unable to load analytics.');
  }
  return <AdminAnalyticsHub overview={data as Parameters<typeof AdminAnalyticsHub>[0]['overview']}
    series={seriesData as Parameters<typeof AdminAnalyticsHub>[0]['series']} period={period}
    section={query.section && ['overview','categories','topics','sponsors','comments'].includes(query.section) ? query.section : 'overview'} />;
}
