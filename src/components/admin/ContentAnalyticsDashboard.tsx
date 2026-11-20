import Link from 'next/link';
import { ArrowLeft, BarChart3, Bookmark, CheckCircle2, Heart, MessageCircle, Users } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { AnalyticsPeriod, ContentAnalytics, DailyContentAnalytics } from '@/lib/analytics/content-analytics';

interface ContentAnalyticsDashboardProps {
  analytics: ContentAnalytics;
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  analyticsHref: string;
  period: AnalyticsPeriod;
  anonymousAnalytics: {
    totals: { topic_impressions: number; topic_viewable_impressions: number; topic_active_duration_ms: number; topic_skips: number; topic_completions: number };
    series: { event_date: string; topic_impressions: number; topic_viewable_impressions: number }[];
    topics: { slug: string; impressions: number; viewable_impressions: number }[];
  };
}

const periods: { value: AnalyticsPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '180 days' },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours} hr`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  signedOutValue,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BarChart3;
  signedOutValue?: string;
}) {
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-text-secondary text-sm font-medium">{label}</p>
          <p className="text-text-primary mt-2 text-3xl font-bold tabular-nums">{value}</p>
          {signedOutValue !== undefined && <p className="text-text-muted mt-1 text-xs tabular-nums">+ {signedOutValue} signed out</p>}
          <p className="text-text-muted mt-2 text-xs">{detail}</p>
        </div>
        <span className="bg-accent-light text-accent rounded-xl p-2.5">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}

function LineChart({ series, anonymousSeries }: { series: DailyContentAnalytics[]; anonymousSeries: { date: string; impressions: number; viewable_impressions: number }[] }) {
  const width = 720;
  const height = 250;
  const padding = { top: 18, right: 20, bottom: 42, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...series.flatMap((item) => [item.impressions, item.viewable_impressions]),
    ...anonymousSeries.flatMap((item) => [item.impressions, item.viewable_impressions])
  );
  const pointFor = (value: number, index: number) => {
    const x =
      padding.left +
      (dates.length <= 1 ? chartWidth / 2 : (index / (dates.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const dates = [...new Set([...series.map((item) => item.date), ...anonymousSeries.map((item) => item.date)])].sort();
  const signedByDate = new Map(series.map((item) => [item.date, item]));
  const anonymousByDate = new Map(anonymousSeries.map((item) => [item.date, item]));
  const impressions = dates.map((date,index) => pointFor(signedByDate.get(date)?.impressions ?? 0,index)).join(' ');
  const viewable = dates.map((date,index) => pointFor(signedByDate.get(date)?.viewable_impressions ?? 0,index)).join(' ');
  const anonymousImpressions = dates.map((date,index) => pointFor(anonymousByDate.get(date)?.impressions ?? 0,index)).join(' ');
  const anonymousViewable = dates.map((date,index) => pointFor(anonymousByDate.get(date)?.viewable_impressions ?? 0,index)).join(' ');
  const gridValues = [0, 0.5, 1].map((fraction) => ({
    fraction,
    y: padding.top + chartHeight - fraction * chartHeight,
    value: Math.round(maxValue * fraction),
  }));

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <span className="text-text-secondary inline-flex items-center gap-2">
          <span className="bg-accent h-2.5 w-2.5 rounded-full" /> Impressions
        </span>
        <span className="text-text-secondary inline-flex items-center gap-2">
          <span className="bg-emerald-600 dark:bg-emerald-400 h-2.5 w-2.5 rounded-full" /> Signed-in viewable impressions
        </span>
        <span className="text-text-secondary inline-flex items-center gap-2"><span className="border-accent h-2.5 w-2.5 rounded-full border" /> Anonymous impressions</span>
        <span className="text-text-secondary inline-flex items-center gap-2"><span className="border-emerald-600 h-2.5 w-2.5 rounded-full border" /> Anonymous viewable</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Daily signed-in and anonymous impressions and viewability"
      >
        {gridValues.map((grid) => (
          <g key={grid.fraction}>
            <line
              x1={padding.left}
              y1={grid.y}
              x2={width - padding.right}
              y2={grid.y}
              className="stroke-border"
              strokeDasharray="4 5"
            />
            <text
              x={padding.left - 10}
              y={grid.y + 4}
              textAnchor="end"
              className="fill-text-muted"
              fontSize="11"
            >
              {formatNumber(grid.value)}
            </text>
          </g>
        ))}
        {series.map((item, index) => {
          const [x, y] = pointFor(item.impressions, index).split(',');
          return (
            <circle
              key={item.date + '-impressions'}
              cx={x}
              cy={y}
              r="3"
              className="fill-accent"
            />
          );
        })}
        {series.map((item, index) => {
          const [x, y] = pointFor(item.viewable_impressions, index).split(',');
          return (
            <circle
              key={item.date + '-viewable'}
              cx={x}
              cy={y}
              r="3"
              className="fill-emerald-600 dark:fill-emerald-400"
            />
          );
        })}
        <polyline
          points={impressions}
          fill="none"
          className="stroke-accent"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={viewable}
          fill="none"
          className="stroke-emerald-600 dark:stroke-emerald-400"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline points={anonymousImpressions} fill="none" className="stroke-accent" strokeWidth="2" strokeDasharray="5 5" />
        <polyline points={anonymousViewable} fill="none" className="stroke-emerald-600" strokeWidth="2" strokeDasharray="5 5" />
        {dates.length > 0 && (
          <>
            <text
              x={padding.left}
              y={height - 10}
              textAnchor="start"
              className="fill-text-muted"
              fontSize="11"
            >
              {formatDate(dates[0])}
            </text>
            <text
              x={width - padding.right}
              y={height - 10}
              textAnchor="end"
              className="fill-text-muted"
              fontSize="11"
            >
              {formatDate(dates[dates.length - 1])}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

function InteractionCard({
  label,
  periodValue,
  lifetimeValue,
}: {
  label: string;
  periodValue: number;
  lifetimeValue: number;
}) {
  return (
    <Card padding="md">
      <p className="text-text-secondary text-sm font-medium">{label}</p>
      <p className="text-text-primary mt-2 text-2xl font-bold tabular-nums">
        {formatNumber(periodValue)}
      </p>
      <p className="text-text-muted mt-1 text-xs">Selected period</p>
      <div className="border-border mt-4 border-t pt-3">
        <p className="text-text-secondary text-sm tabular-nums">
          {formatNumber(lifetimeValue)} <span className="text-text-muted">lifetime</span>
        </p>
      </div>
    </Card>
  );
}

export function ContentAnalyticsDashboard({
  analytics,
  title,
  description,
  backHref,
  backLabel,
  analyticsHref,
  period,
  anonymousAnalytics,
}: ContentAnalyticsDashboardProps) {
  const hasTelemetry = analytics.last_event_at !== null;
  const events = analytics.events;
  const anonymous = anonymousAnalytics.totals;
  const anonymousSeries = anonymousAnalytics.series.map((day) => ({ date: day.event_date, impressions: day.topic_impressions, viewable_impressions: day.topic_viewable_impressions }));
  const hasAnyTelemetry = hasTelemetry || anonymous.topic_impressions > 0;
  const skipRate =
    events.impressions > 0 ? (events.skips / events.impressions) * 100 : null;
  const completionRate =
    events.impressions > 0 ? (events.completions / events.impressions) * 100 : null;
  const averageActiveSeconds =
    events.viewable_impressions > 0
      ? events.active_seconds / events.viewable_impressions
      : null;

  const eventMetrics = [
    {
      label: 'Signed-in impressions',
      value: hasTelemetry ? formatNumber(events.impressions) : '—',
      signedOutValue: anonymous.topic_impressions > 0 ? formatNumber(anonymous.topic_impressions) : undefined,
      detail: 'Topic feed cards displayed',
      icon: BarChart3,
    },
    {
      label: 'Signed-in viewable impressions',
      value: hasTelemetry ? formatNumber(events.viewable_impressions) : '—',
      signedOutValue: anonymous.topic_viewable_impressions > 0 ? formatNumber(anonymous.topic_viewable_impressions) : undefined,
      detail: 'At least 50% visible for one second',
      icon: Users,
    },
    {
      label: 'Unique signed-in viewers',
      value: hasTelemetry ? formatNumber(events.unique_viewers) : '—',
      detail: 'Distinct signed-in viewers',
      icon: Users,
    },
    {
      label: 'Signed-in active reading time',
      value: hasTelemetry ? formatDuration(events.active_seconds) : '—',
      detail: 'Time while visible and active',
      icon: BarChart3,
    },
    {
      label: 'Signed-in skip rate',
      value: hasTelemetry && skipRate !== null ? `${skipRate.toFixed(1)}%` : '—',
      detail: 'Early skips ÷ impressions',
      icon: BarChart3,
    },
    {
      label: 'Signed-in average active time',
      value:
        hasTelemetry && averageActiveSeconds !== null
          ? formatDuration(averageActiveSeconds)
          : '—',
      detail: 'Active time per viewable impression',
      icon: BarChart3,
    },

    {
      label: 'Signed-in average slide depth',
      value: hasTelemetry ? formatNumber(events.average_slide_depth) : '—',
      detail: 'Average slide index reached (1–4)',
      icon: BarChart3,
    },
    {
      label: 'Signed-in completion events',
      value: hasTelemetry ? formatNumber(events.completions) : '—',
      detail: 'Completed topic reading sessions',
      icon: CheckCircle2,
    },
    {
      label: 'Signed-in average completion',
      value: hasTelemetry ? `${events.average_completion_percent.toFixed(1)}%` : '—',
      detail: 'Average recorded completion percentage',
      icon: CheckCircle2,
    },
    {
      label: 'Signed-in completion rate',
      value:
        hasTelemetry && completionRate !== null ? `${completionRate.toFixed(1)}%` : '—',
      detail: 'Completions ÷ impressions',
      icon: CheckCircle2,
    },
    {
      label: 'Signed-in return visits',
      value: hasTelemetry ? formatNumber(events.return_visits) : '—',
      detail: 'Additional visits to this content',
      icon: Users,
    },
  ];

  const interactions = [
    { label: 'Likes', icon: Heart, key: 'likes' as const },
    { label: 'Bookmarks', icon: Bookmark, key: 'bookmarks' as const },
    { label: 'Comments', icon: MessageCircle, key: 'comments' as const },
    { label: 'Replies', icon: MessageCircle, key: 'replies' as const },
    { label: 'Comment likes', icon: Heart, key: 'comment_likes' as const },
    { label: 'Completed topics', icon: CheckCircle2, key: 'completed_topics' as const },
  ];

  return (
    <main className="container py-12">
      <div className="mt-4">
        <Link
          href={backHref}
          className="text-accent inline-flex items-center gap-2 text-sm font-medium hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to {backLabel}
        </Link>
        <div className="mt-8">
          <h1 className="text-4xl font-extrabold md:text-5xl">{title}</h1>
          <p className="text-text-secondary mt-4 max-w-3xl">{description}</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Badge variant="accent" size="lg">
          {analytics.entity_type === 'topic' ? 'Topic analytics' : 'Category analytics'}
        </Badge>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Analytics date range">
          {periods.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              variant={period === option.value ? 'primary' : 'secondary'}
              className={period === option.value ? '!text-white dark:!text-[#241f1a]' : undefined}
            >
              <Link
                href={`${analyticsHref}?period=${option.value}`}
                aria-current={period === option.value ? 'page' : undefined}
              >
                {option.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-5">
          <h2 className="text-2xl font-bold">Feed performance</h2>
          <p className="text-text-secondary mt-1 text-sm">
            {hasTelemetry ? (
              <>
                Earliest retained event{' '}
                {formatDate(
                  analytics.first_retained_event_at ?? (analytics.last_event_at as string)
                )}{' '}
                · Last event {formatDate(analytics.last_event_at as string)}
              </>
            ) : anonymous.topic_impressions > 0 ? (
              <>No signed-in feed events are retained for this content in the selected period. Anonymous aggregate activity is available below; no anonymous unique-person count is calculated.</>
            ) : analytics.first_retained_event_at ? (
              <>
                Feed event collection has started, but no events are retained for this content.
                The earliest retained event is {formatDate(analytics.first_retained_event_at)}.
              </>
            ) : (
              <>
                No retained feed events are available for this content. Impressions and reading
                time outside the 180-day retention window cannot be reconstructed.
              </>
            )}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {eventMetrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Anonymous impressions" value={formatNumber(anonymous.topic_impressions)} detail="Signed-out topic feed impressions" icon={BarChart3} />
          <MetricCard label="Anonymous viewable" value={formatNumber(anonymous.topic_viewable_impressions)} detail="At least 50% visible for one second" icon={Users} />
          <MetricCard label="Anonymous active time" value={formatDuration(anonymous.topic_active_duration_ms / 1000)} detail="Time while signed-out content was visible" icon={BarChart3} />
          <MetricCard label="Anonymous skips / completions" value={formatNumber(anonymous.topic_skips) + ' / ' + formatNumber(anonymous.topic_completions)} detail="Aggregate events; no anonymous unique-user count" icon={CheckCircle2} />
        </div>
      </section>

      <section className="mt-10">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Daily feed activity</CardTitle>
            <CardDescription>
              Signed-in event telemetry is retained for 180 days. Anonymous daily aggregates are shown separately and do not include unique-person counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {hasAnyTelemetry && (analytics.series.length > 0 || anonymousSeries.length > 0) ? (
              <LineChart series={analytics.series} anonymousSeries={anonymousSeries} />
            ) : (
              <div className="border-border bg-bg-primary rounded-2xl border px-5 py-12 text-center">
                <BarChart3 className="text-text-muted mx-auto h-8 w-8" aria-hidden="true" />
                <p className="text-text-primary mt-3 font-semibold">No feed activity to chart yet</p>
                <p className="text-text-secondary mx-auto mt-1 max-w-xl text-sm">
                  This chart includes separately measured signed-in and anonymous aggregate activity.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-10">
        <div className="mb-5">
          <h2 className="text-2xl font-bold">Community and learning activity</h2>
          <p className="text-text-secondary mt-1 text-sm">
            These records predate feed analytics and are shown separately. The large figure is the
            selected period; lifetime totals are shown below.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {interactions.map((item) => (
            <InteractionCard
              key={item.key}
              label={item.label}
              periodValue={analytics.interactions.period[item.key]}
              lifetimeValue={analytics.interactions.lifetime[item.key]}
            />
          ))}
        </div>
      </section>

      {analytics.entity_type === 'category' && analytics.category_content && (
        <section className="mt-10">
          <div className="mb-5">
            <h2 className="text-2xl font-bold">Topic coverage</h2>
            <p className="text-text-secondary mt-1 text-sm">
              Content distribution in this category, including unpublished topics.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              label="Total topics"
              value={formatNumber(analytics.category_content.total_topics)}
              detail="All topics in this category"
              icon={BarChart3}
            />
            <MetricCard
              label="Published"
              value={formatNumber(analytics.category_content.published_topics)}
              detail="Visible to learners"
              icon={CheckCircle2}
            />
            <MetricCard
              label="Unpublished"
              value={formatNumber(analytics.category_content.unpublished_topics)}
              detail="Not currently visible"
              icon={BarChart3}
            />
          </div>

          <Card padding="lg" className="mt-6">
            <CardHeader>
              <CardTitle>Top topics</CardTitle>
              <CardDescription>
                Published topics ranked by selected-period impressions, then likes, bookmarks and
                comments.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {analytics.top_topics.length > 0 ? (
                <div className="space-y-3">
                  {analytics.top_topics.map((topic) => (
                    <Link
                      key={topic.slug}
                      href={`/topic/${encodeURIComponent(topic.slug)}/analytics`}
                      className="border-border hover:bg-accent-light/10 block rounded-xl border p-4 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="text-text-primary text-base leading-snug font-semibold">
                          {topic.question}
                        </h3>
                        <span className="text-accent shrink-0 text-sm font-medium">
                          View analytics
                        </span>
                      </div>
                      <div className="text-text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span>
                          {hasTelemetry ? formatNumber(topic.impressions) : '—'} signed-in · {formatNumber(anonymousAnalytics.topics.find((item) => item.slug === topic.slug)?.impressions ?? 0)} anonymous impressions
                        </span>
                        <span>{formatNumber(topic.likes)} likes</span>
                        <span>{formatNumber(topic.bookmarks)} bookmarks</span>
                        <span>{formatNumber(topic.comments)} comments</span>
                        <span>{formatNumber(topic.replies)} replies</span>
                        <span>{formatNumber(topic.comment_likes)} comment likes</span>
                        <span>{formatNumber(topic.completed_topics)} completions</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary border-border rounded-xl border p-5 text-sm">
                  No published topics are available in this category.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      <p className="text-text-muted mt-8 text-xs">
        Reporting window: {formatDate(analytics.range_start)} – {formatDate(analytics.range_end)}.
        Feed events are retained for 180 days. Interaction totals are read from the existing application records.
      </p>
    </main>
  );
}
