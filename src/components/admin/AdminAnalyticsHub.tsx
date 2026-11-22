import Link from 'next/link';
import { Activity, ArrowUpRight, BarChart3, BookOpen, CheckCircle2, Heart, MessageCircle, Megaphone, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { AnalyticsDeepDivePanel, type AnalyticsDeepDiveData } from '@/components/admin/AnalyticsDeepDivePanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardTitle } from '@/components/ui/Card';
import type { AnalyticsPeriod } from '@/lib/analytics/content-analytics';

type AnalyticsDay = { event_date: string; topic_impressions: number; sponsor_served: number; comment_impressions: number; topic_viewable_impressions: number; sponsor_viewable_impressions: number; sponsor_clicks: number; comment_viewable_impressions: number };

type Overview = {
  totals: {
    topic_impressions: number; topic_viewable_impressions: number; topic_active_duration_ms: number;
    topic_skips: number; topic_completions: number; sponsor_served: number;
    sponsor_viewable_impressions: number; sponsor_clicks: number;
    comment_card_impressions: number; comment_card_viewable_impressions: number;
    comment_card_active_duration_ms: number; comment_card_skips: number; comment_card_opens: number;
    category_count: number; topic_count: number; sponsor_count: number; comment_count: number;
    topic_likes: number; bookmarks: number; completed_topics: number; comments_created: number; replies: number; comment_likes: number;
    unique_topic_viewers: number; unique_sponsor_viewers: number; unique_comment_viewers: number; unique_feed_viewers: number;

  };
  categories: { slug: string; name: string; topic_count: number; impressions: number; viewable_impressions: number }[];
  topics: { id: string; slug: string; question: string; category_slug: string; impressions: number; viewable_impressions: number; active_duration_ms: number }[];
  sponsors: { id: string; sponsor_name: string; status: string; campaign_count: number; served: number; viewable_impressions: number; clicks: number }[];
  comments: { id: number; topic_id: string; topic_question: string | null; created_at: string; impressions: number; viewable_impressions: number; active_duration_ms: number; skips: number; opens: number; likes: number; replies: number }[];
};

const periods: { value: AnalyticsPeriod; label: string }[] = [
  { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' }, { value: '180d', label: '180 days' },
];

const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + ' sec';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + ' hr ' + (minutes % 60) + ' min';
};

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return <Card padding="md"><div className="flex items-start justify-between gap-3"><div className="min-w-0">
    <p className="text-text-secondary text-sm font-medium">{label}</p>
    <p className="text-text-primary mt-2 text-3xl font-bold tabular-nums">{value}</p>
    <p className="text-text-muted mt-2 text-xs">{detail}</p>
  </div><span className="bg-accent-light text-accent rounded-xl p-2.5"><Icon className="h-5 w-5" aria-hidden="true" /></span></div></Card>;
}
}

function SectionCard({ title, description, count, href, icon: Icon, children }: {
  title: string; description: string; count: string; href: string; icon: typeof Activity; children: ReactNode;
}) {
  return <Card padding="lg" className="h-full"><div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-3"><span className="bg-accent-light text-accent rounded-xl p-2.5"><Icon className="h-5 w-5" /></span><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></div>
    <Badge variant="outline">{count}</Badge>
  </div><div className="mt-5 space-y-2">{children}</div><Link href={href} className="text-accent mt-5 inline-flex items-center gap-1 text-sm font-semibold hover:underline">Explore {title.toLowerCase()} <ArrowUpRight className="h-4 w-4" /></Link></Card>;
}

function EntityLink({ href, title, detail, metric }: { href: string; title: string; detail: string; metric: string }) {
  return <Link href={href} className="border-border hover:bg-accent-light/10 flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors">
    <span className="min-w-0"><span className="text-text-primary block truncate text-sm font-semibold">{title}</span><span className="text-text-muted mt-0.5 block truncate text-xs">{detail}</span></span>
    <span className="text-text-secondary shrink-0 text-xs tabular-nums">{metric}</span>
  </Link>;
}


function DailyOverviewChart({ series }: { series: AnalyticsDay[] }) {
  const width = 760;
  const height = 250;
  const padding = { left: 42, right: 18, top: 18, bottom: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = series.flatMap((day) => [day.topic_impressions, day.sponsor_served, day.comment_impressions]);
  const max = Math.max(1, ...values);
  const point = (value: number, index: number) => {
    const x = padding.left + (series.length <= 1 ? chartWidth / 2 : index / (series.length - 1) * chartWidth);
    const y = padding.top + chartHeight - value / max * chartHeight;
    return x.toFixed(1) + ',' + y.toFixed(1);
  };
  const topic = series.map((day, index) => point(day.topic_impressions, index)).join(' ');
  const sponsor = series.map((day, index) => point(day.sponsor_served, index)).join(' ');
  const comments = series.map((day, index) => point(day.comment_impressions, index)).join(' ');
  return <Card padding="lg" className="mt-6">
    <div><h2 className="text-xl font-bold">Daily feed activity</h2><p className="text-text-muted mt-1 text-sm">Separate daily trends for learning topics, paid sponsor delivery and Top Comments.</p></div>
    <div className="mt-5 flex flex-wrap gap-4 text-xs">
      <span className="text-text-secondary inline-flex items-center gap-2"><span className="bg-accent h-2.5 w-2.5 rounded-full" /> Signed-in topic impressions</span>
      <span className="text-text-secondary inline-flex items-center gap-2"><span className="bg-emerald-600 h-2.5 w-2.5 rounded-full" /> Signed-in sponsor deliveries</span>
      <span className="text-text-secondary inline-flex items-center gap-2"><span className="bg-sky-600 h-2.5 w-2.5 rounded-full" /> Signed-in comment-card impressions</span>
    </div>
    {series.length ? <svg viewBox={'0 0 ' + width + ' ' + height} className="mt-3 h-auto w-full" role="img" aria-label="Daily topic, sponsor and comment card activity">
      {[0,0.5,1].map((fraction) => <g key={fraction}><line x1={padding.left} y1={padding.top+chartHeight*(1-fraction)} x2={width-padding.right} y2={padding.top+chartHeight*(1-fraction)} className="stroke-border" strokeDasharray="4 5" /><text x={padding.left-9} y={padding.top+chartHeight*(1-fraction)+4} textAnchor="end" className="fill-text-muted" fontSize="11">{number(Math.round(max*fraction))}</text></g>)}
      <polyline points={topic} fill="none" className="stroke-accent" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={sponsor} fill="none" className="stroke-emerald-600" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={comments} fill="none" className="stroke-sky-600" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {series.length > 0 && <><text x={padding.left} y={height-8} className="fill-text-muted" fontSize="11">{series[0].event_date}</text><text x={width-padding.right} y={height-8} textAnchor="end" className="fill-text-muted" fontSize="11">{series[series.length-1].event_date}</text></>}
    </svg> : <p className="text-text-muted mt-6 text-sm">No daily activity has been recorded in this period yet.</p>}
  </Card>;
}

export function AdminAnalyticsHub({ overview, period, section = 'overview', series, deepDive }: { overview: Overview; period: AnalyticsPeriod; section?: string; series: AnalyticsDay[]; deepDive: AnalyticsDeepDiveData }) {
  const t = overview.totals;
  const totalExposures = t.topic_impressions + t.sponsor_served + t.comment_card_impressions;
  const sectionHref = (value: string) => `/admin/analytics?period=${period}&section=${value}`;
  const showAll = section === 'overview';
  const categories = showAll ? overview.categories.slice(0, 5) : overview.categories;
  const topics = showAll ? overview.topics.slice(0, 5) : overview.topics;
  const sponsors = showAll ? overview.sponsors.slice(0, 5) : overview.sponsors;
  const comments = showAll ? overview.comments.slice(0, 5) : overview.comments;

  return <main className="container py-12">
    <div className="mt-6"><h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Analytics</h1>
      <p className="text-text-secondary mt-4 max-w-3xl">A unified view of learning activity, community engagement and sponsored delivery. Select any area to explore its performance in detail.</p>
    </div>
    <div className="mt-8"><AdminNavigation /></div>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">{section === 'overview' ? 'Overall performance' : section[0]?.toUpperCase() + section.slice(1)}</h2>
        <p className="text-text-muted mt-1 text-sm">Reporting window · {periods.find((item) => item.value === period)?.label}</p></div>
      <div className="flex flex-wrap gap-2" aria-label="Analytics date range">
        {periods.map((item) => <Button key={item.value} asChild size="sm" variant={period === item.value ? 'primary' : 'secondary'} className={period === item.value ? '!text-white dark:!text-[#241f1a]' : undefined}>
          <Link href={`/admin/analytics?period=${item.value}&section=${section}`} aria-current={period === item.value ? 'page' : undefined}>{item.label}</Link>
        </Button>)}
      </div>
    </div>
    <nav aria-label="Analytics views" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {[
        { value: 'overview', label: 'Overall', description: 'All feed streams and trends', count: number(totalExposures), suffix: 'placements', icon: Activity },
        { value: 'categories', label: 'Categories', description: 'Reach by category', count: number(t.category_count), suffix: 'categories', icon: BarChart3 },
        { value: 'topics', label: 'Topics', description: 'Reading and completion', count: number(t.topic_count), suffix: 'topics', icon: BookOpen },
        { value: 'sponsors', label: 'Sponsors', description: 'Delivery and campaign results', count: number(t.sponsor_count), suffix: 'sponsors', icon: Megaphone },
        { value: 'comments', label: 'Comments', description: 'Exposure and community activity', count: number(t.comment_count), suffix: 'comments', icon: MessageCircle },
      ].map((item) => {
        const Icon = item.icon;
        return <Link key={item.value} href={sectionHref(item.value)} aria-current={section === item.value ? 'page' : undefined}
          className={`rounded-2xl border p-4 transition-colors ${section === item.value ? 'border-accent bg-accent-light/20 ring-1 ring-accent/30' : 'border-border hover:bg-bg-secondary'}`}>
          <div className="flex items-center justify-between gap-2"><span className="text-text-primary text-sm font-semibold">{item.label}</span><Icon className={`h-4 w-4 ${section === item.value ? 'text-accent' : 'text-text-muted'}`} aria-hidden="true" /></div>
          <p className="text-text-muted mt-2 text-xs">{item.description}</p>
          <p className="text-text-primary mt-4 text-xl font-bold tabular-nums">{item.count}</p>
          <p className="text-text-muted text-xs">{item.suffix}</p>
        </Link>;
      })}
    </nav>

    <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total feed placements" value={number(totalExposures)} detail="Topic, sponsor and Top Comments placements; stream metrics remain separate below" icon={Activity} />
      <Metric label="Topic impressions" value={number(t.topic_impressions)} detail={number(t.topic_viewable_impressions) + ' viewable · ' + duration(t.topic_active_duration_ms) + ' active time'} icon={BookOpen} />
      <Metric label="Sponsored delivery" value={number(t.sponsor_served)} detail={number(t.sponsor_viewable_impressions) + ' viewable · ' + number(t.sponsor_clicks) + ' clicks'} icon={Megaphone} />
      <Metric label="Top Comments exposure" value={number(t.comment_card_impressions)} detail={number(t.comment_card_viewable_impressions) + ' viewable · ' + number(t.comment_card_opens) + ' discussion opens'} icon={MessageCircle} />
    </section>

    <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Topic viewability" value={t.topic_impressions ? ((t.topic_viewable_impressions / t.topic_impressions) * 100).toFixed(1) + '%' : '—'} detail="Viewable impressions ÷ opted-in impressions" icon={Activity} />
      <Metric label="Topic completion rate" value={t.topic_impressions ? ((t.topic_completions / t.topic_impressions) * 100).toFixed(1) + '%' : '—'} detail="Completions ÷ opted-in impressions" icon={BookOpen} />
      <Metric label="Sponsor click-through" value={t.sponsor_viewable_impressions ? ((t.sponsor_clicks / t.sponsor_viewable_impressions) * 100).toFixed(2) + '%' : '—'} detail="Clicks ÷ opted-in viewable impressions" icon={Megaphone} />
      <Metric label="Comment-card viewability" value={t.comment_card_impressions ? ((t.comment_card_viewable_impressions / t.comment_card_impressions) * 100).toFixed(1) + '%' : '—'} detail="Viewable impressions ÷ opted-in impressions" icon={MessageCircle} />
    </section>


    <section className="mt-10 grid gap-5 lg:grid-cols-2">
      {(section === 'overview' || section === 'categories') && <SectionCard title="Categories" description="Compare category reach and topic coverage." count={number(t.category_count)} href={sectionHref('categories')} icon={BarChart3}>
        {categories.map((item) => <EntityLink key={item.slug} href={`/categories/${encodeURIComponent(item.slug)}/analytics?period=${period}`} title={item.name} detail={number(item.topic_count) + ' topics'} metric={number(item.impressions) + ' opted-in impressions'} />)}
        {categories.length === 0 && <p className="text-text-muted text-sm">No categories available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'topics') && <SectionCard title="Topics" description="Inspect individual learning content and reading behaviour." count={number(t.topic_count)} href={sectionHref('topics')} icon={BookOpen}>
        {topics.map((item) => <EntityLink key={item.id} href={`/topic/${encodeURIComponent(item.slug)}/analytics?period=${period}`} title={item.question} detail={item.category_slug} metric={number(item.impressions) + ' signed-in · ' + number(item.anonymous_impressions ?? 0) + ' anonymous'} />)}
        {topics.length === 0 && <p className="text-text-muted text-sm">No topics available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'sponsors') && <SectionCard title="Sponsors" description="Track paid delivery, viewability and campaign clicks." count={number(t.sponsor_count)} href={sectionHref('sponsors')} icon={Megaphone}>
        {sponsors.map((item) => <EntityLink key={item.id} href={`/admin/analytics/sponsors/${item.id}?period=${period}`} title={item.sponsor_name} detail={item.status + ' · ' + item.campaign_count + ' campaigns'} metric={number(item.viewable_impressions) + ' measured viewable · ' + number(item.clicks) + ' clicks'} />)}
        {sponsors.length === 0 && <p className="text-text-muted text-sm">No sponsors available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'comments') && <SectionCard title="Comments" description="Measure Top Comments card exposure separately from likes and replies." count={number(t.comment_count)} href={sectionHref('comments')} icon={MessageCircle}>
        {comments.map((item) => <EntityLink key={item.id} href={`/admin/analytics/comments/${item.id}?period=${period}`} title={item.topic_question ?? 'Comment #' + item.id} detail={number(item.likes) + ' likes · ' + number(item.replies) + ' replies'} metric={number(item.impressions) + ' signed-in · ' + number(item.anonymous_impressions ?? 0) + ' anonymous'} />)}
        {comments.length === 0 && <p className="text-text-muted text-sm">No comments available.</p>}
      </SectionCard>}
    </section>
    <Card padding="md" className="mt-8"><p className="text-text-secondary text-sm">Measurement notes</p>
      <p className="text-text-muted mt-2 text-xs leading-relaxed">Topic feed impressions, sponsor viewability/click events and Top Comments card exposures are separate opted-in event streams. Unique viewers count signed-in accounts only. Comment likes and replies are shown as community interactions and are not added to feed impressions. Comment-card exposure tracking begins when the new client instrumentation is deployed; historical exposure cannot be reconstructed.</p>
    </Card>
  </main>;
}
