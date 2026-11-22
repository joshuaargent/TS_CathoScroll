import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { requireAdminPage } from '@/lib/moderation/require-admin';
import { checkApiRateLimit } from '@/lib/security/api-rate-limit';
import { getAnalyticsRange, isAnalyticsPeriod, type AnalyticsPeriod } from '@/lib/analytics/content-analytics';
import { isValidUuid } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Entity Analytics', robots: { index: false, follow: false } };
interface Props { params: Promise<{ kind: string; id: string }>; searchParams?: Promise<{ period?: string }> }

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card padding="md"><p className="text-text-secondary text-sm font-medium">{label}</p><p className="text-text-primary mt-2 text-3xl font-bold tabular-nums">{value}</p><p className="text-text-muted mt-2 text-xs">{detail}</p></Card>;
}
const fmt = (value: unknown) => new Intl.NumberFormat('en-GB').format(typeof value === 'number' && Number.isFinite(value) ? value : 0);

function TrendChart({ kind, series }: { kind: 'sponsors' | 'comments'; series: Record<string, unknown>[] }) {
  const width = 720;
  const height = 250;
  const padding = { left: 44, right: 20, top: 18, bottom: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const lines = kind === 'sponsors'
    ? [
        { key: 'viewable_impressions', label: 'Opted-in viewable impressions', color: 'stroke-emerald-600 dark:stroke-emerald-400', dot: 'bg-emerald-600 dark:bg-emerald-400' },
        { key: 'clicks', label: 'Opted-in clicks', color: 'stroke-sky-600 dark:stroke-sky-400', dot: 'bg-sky-600 dark:bg-sky-400' },
      ]
    : [
        { key: 'impressions', label: 'Opted-in impressions', color: 'stroke-accent', dot: 'bg-accent' },
        { key: 'viewable_impressions', label: 'Opted-in viewable impressions', color: 'stroke-emerald-600 dark:stroke-emerald-400', dot: 'bg-emerald-600 dark:bg-emerald-400' },
      ];
  const values = series.flatMap((row) => lines.map((line) => Number(row[line.key] ?? 0)));
  const max = Math.max(1, ...values);
  const points = (key: string) => series.map((row, index) => {
    const x = padding.left + (series.length <= 1 ? chartWidth / 2 : index / (series.length - 1) * chartWidth);
    const y = padding.top + chartHeight - Number(row[key] ?? 0) / max * chartHeight;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return <Card padding="lg" className="mt-8">
    <h2 className="text-xl font-bold">Daily performance</h2>
    <p className="text-text-muted mt-1 text-sm">Daily opted-in account-linked activity across the selected reporting window.</p>
    <div className="mt-5 flex flex-wrap gap-4 text-xs">{lines.map((line) => <span key={line.key} className="text-text-secondary inline-flex items-center gap-2"><span className={'h-2.5 w-2.5 rounded-full ' + line.dot} />{line.label}</span>)}</div>
    {series.length ? <svg viewBox={'0 0 ' + width + ' ' + height} className="mt-3 h-auto w-full" role="img" aria-label="Daily opted-in analytics trend">
      {[0,0.5,1].map((fraction) => <g key={fraction}><line x1={padding.left} y1={padding.top+chartHeight*(1-fraction)} x2={width-padding.right} y2={padding.top+chartHeight*(1-fraction)} className="stroke-border" strokeDasharray="4 5" /><text x={padding.left-9} y={padding.top+chartHeight*(1-fraction)+4} textAnchor="end" className="fill-text-muted" fontSize="11">{fmt(Math.round(max*fraction))}</text></g>)}
      {lines.map((line) => <polyline key={line.key} points={points(line.key)} fill="none" className={line.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
      <text x={padding.left} y={height-8} className="fill-text-muted" fontSize="11">{String(series[0].event_date ?? '')}</text>
      <text x={width-padding.right} y={height-8} textAnchor="end" className="fill-text-muted" fontSize="11">{String(series[series.length-1].event_date ?? '')}</text>
    </svg> : <p className="text-text-muted mt-6 text-sm">No opted-in analytics have been recorded in this period.</p>}
  </Card>;
}

export default async function AdminAnalyticsEntityPage({ params, searchParams }: Props) {
  const { kind, id } = await params;
  const query = (await searchParams) ?? {};
  if (kind !== 'sponsors' && kind !== 'comments') notFound();
  if (kind === 'sponsors' && !isValidUuid(id)) notFound();
  if (kind === 'comments' && (!/^\\d{1,18}$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)) notFound();

  const period: AnalyticsPeriod = isAnalyticsPeriod(query.period) ? query.period : '30d';
  const { from, to } = getAnalyticsRange(period);
  const { adminClient, user } = await requireAdminPage(`/admin/analytics/${kind}/${encodeURIComponent(id)}`);
  const rateLimit = await checkApiRateLimit({ scope: 'admin:analytics:read', identifier: user.id, limit: 60, windowSeconds: 60 });
  if (!rateLimit.allowed) throw new Error('Analytics are temporarily unavailable. Please try again.');

  let title = '';
  let description = '';
  let totals: Record<string, unknown> = {};
  let series: Record<string, unknown>[] = [];
  let campaigns: { id: string; name: string; status: string }[] = [];

  if (kind === 'sponsors') {
    const [{ data: sponsor, error: sponsorError }, { data, error }] = await Promise.all([
      adminClient.from('sponsors').select('id,sponsor_name,status').eq('id', id).maybeSingle(),
      adminClient.rpc('get_admin_sponsor_analytics', { p_actor_user_id: user.id, p_sponsor_id: id, p_from: from.toISOString(), p_to: to.toISOString() }),
    ]);
    if (sponsorError || error) throw new Error('Unable to load sponsor analytics.');
    if (!sponsor) notFound();
    title = sponsor.sponsor_name;
    description = 'Account-linked viewability and clicks from signed-in users who enabled Sponsor measurement. Sponsor deliveries are not counted.';
    const payload = data as { totals?: Record<string, unknown>; series?: Record<string, unknown>[]; campaigns?: { id: string; name: string; status: string }[] } | null;
    totals = payload?.totals ?? {};
    series = payload?.series ?? [];
    campaigns = payload?.campaigns ?? [];
  } else {
    const [{ data: comment, error: commentError }, { data, error }] = await Promise.all([
      adminClient.from('comments').select('id,topic_id,content,created_at,is_deleted').eq('id', Number(id)).maybeSingle(),
      adminClient.rpc('get_admin_feed_card_analytics', { p_actor_user_id: user.id, p_from: from.toISOString(), p_to: to.toISOString(), p_card_type: 'top-comment', p_card_id: id }),
    ]);
    if (commentError || error) throw new Error('Unable to load comment analytics.');
    if (!comment || comment.is_deleted) notFound();
    const { data: topic } = await adminClient.from('topics').select('question,slug').eq('id', comment.topic_id).maybeSingle();
    const [{ count: likes }, { count: replies }] = await Promise.all([
      adminClient.from('comment_likes').select('id', { count: 'exact', head: true }).eq('comment_id', Number(id)).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
      adminClient.from('comments').select('id', { count: 'exact', head: true }).eq('parent_id', Number(id)).eq('is_deleted', false).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
    ]);
    title = `Comment #${id}`;
    description = (topic?.question ?? 'Top-level community comment') + ' · ' + comment.content.slice(0, 180);
    const payload = data as { totals?: Record<string, unknown>; series?: Record<string, unknown>[] } | null;
    totals = { ...(payload?.totals ?? {}), likes: likes ?? 0, replies: replies ?? 0 };
    series = payload?.series ?? [];
  }

  return <main className="container py-12">
    <div className="mt-6"><Link href={`/admin/analytics?period=${period}&section=${kind}`} className="text-accent text-sm font-medium hover:underline">← Back to {kind} analytics</Link>
      <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">{title}</h1>
      <p className="text-text-secondary mt-3 max-w-3xl">{description}</p>
    </div>
    <div className="mt-8"><AdminNavigation /></div>
    <div className="mt-5 flex flex-wrap gap-2">{(['7d','30d','90d','180d'] as AnalyticsPeriod[]).map((value) =>
      <Link key={value} href={`/admin/analytics/${kind}/${id}?period=${value}`} className={`rounded-lg border px-4 py-2 text-sm ${period === value ? 'border-accent bg-accent-light text-accent font-semibold' : 'border-border text-text-secondary'}`}>{value}</Link>)}</div>
    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {kind === 'sponsors' ? <>
        <Metric label="Opted-in viewable impressions" value={fmt(totals.viewable_impressions)} detail="Signed-in users who enabled Sponsor measurement" />
        <Metric label="Opted-in clicks" value={fmt(totals.clicks)} detail="Clicks on opted-in viewable sponsor placements" />
        <Metric label="Opted-in active time" value={Math.round(Number(totals.active_duration_ms ?? 0) / 1000) + ' sec'} detail="Time on viewable sponsor placements" />
        <Metric label="Active campaigns" value={fmt(totals.active_campaigns)} detail="Campaigns with opted-in measured activity" />
      </> : <>
        <Metric label="Opted-in card impressions" value={fmt(totals.impressions)} detail="Top Comments cards shown to opted-in signed-in users" />
        <Metric label="Opted-in viewable" value={fmt(totals.viewable_impressions)} detail="At least 50% visible for one second" />
        <Metric label="Active time" value={Math.round(Number(totals.active_duration_ms ?? 0) / 1000) + ' sec'} detail="Time while visible and active" />
        <Metric label="Discussion opens" value={fmt(totals.opens)} detail="Open-comment actions" />
        <Metric label="Skips" value={fmt(totals.skips)} detail="Cards left before meaningful viewing time" />
        <Metric label="Likes / replies" value={fmt(totals.likes) + ' / ' + fmt(totals.replies)} detail="Existing community interaction records, shown separately" />
      </>}
    </div>
    <TrendChart kind={kind} series={series} />
    {kind === 'sponsors' && <Card padding="lg" className="mt-8"><h2 className="text-xl font-bold">Campaigns</h2><p className="text-text-muted mt-1 text-sm">Campaigns belonging to this sponsor.</p><div className="mt-4 divide-border divide-y">{campaigns.map((campaign) => <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-text-primary text-sm font-semibold">{campaign.name}</span><Badge variant="outline">{campaign.status}</Badge></div>)}</div>{campaigns.length === 0 && <p className="text-text-muted mt-4 text-sm">No campaigns are associated with this sponsor.</p>}</Card>}
    <Card padding="lg" className="mt-8"><h2 className="text-xl font-bold">Daily activity</h2>
      <p className="text-text-muted mt-1 text-sm">Daily aggregate rows for the selected reporting period.</p>
      {series.length ? <div className="mt-4 divide-border divide-y">{series.map((row, index) => <div key={String(row.event_date ?? index)} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span className="text-text-secondary">{String(row.event_date ?? '')}</span><span className="text-text-primary tabular-nums">{kind === 'sponsors' ? fmt(row.viewable_impressions) + ' measured viewable · ' + fmt(row.clicks) + ' clicks' : fmt(row.impressions) + ' impressions · ' + fmt(row.viewable_impressions) + ' viewable'}</span></div>)}</div> : <p className="text-text-muted mt-5 text-sm">No opted-in analytics have been recorded for this item in the selected period.</p>}
    </Card>
    <p className="text-text-muted mt-6 text-xs">No user identifiers or raw event records are exposed on this page.</p>
  </main>;
}
