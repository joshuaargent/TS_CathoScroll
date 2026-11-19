import Link from 'next/link';
import { Activity, ArrowUpRight, BarChart3, BookOpen, Heart, MessageCircle, Megaphone, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { AdminNavigation } from '@/components/admin/AdminNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardTitle } from '@/components/ui/Card';
import type { AnalyticsPeriod } from '@/lib/analytics/content-analytics';

type Overview = {
  totals: {
    topic_impressions: number; topic_viewable_impressions: number; topic_active_duration_ms: number;
    topic_skips: number; topic_completions: number; sponsor_served: number;
    sponsor_viewable_impressions: number; sponsor_clicks: number;
    comment_card_impressions: number; comment_card_viewable_impressions: number;
    comment_card_active_duration_ms: number; comment_card_skips: number; comment_card_opens: number;
    category_count: number; topic_count: number; sponsor_count: number; comment_count: number;
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

function SectionCard({ title, description, count, href, icon: Icon, children }: {
  title: string; description: string; count: string; href: string; icon: typeof Activity; children: ReactNode;
}) {
  return <Card padding="lg" className="h-full"><div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-3"><span className="bg-accent-light text-accent rounded-xl p-2.5"><Icon className="h-5 w-5" /></span><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></div>
    <Badge variant="secondary">{count}</Badge>
  </div><div className="mt-5 space-y-2">{children}</div><Link href={href} className="text-accent mt-5 inline-flex items-center gap-1 text-sm font-semibold hover:underline">Explore {title.toLowerCase()} <ArrowUpRight className="h-4 w-4" /></Link></Card>;
}

function EntityLink({ href, title, detail, metric }: { href: string; title: string; detail: string; metric: string }) {
  return <Link href={href} className="border-border hover:bg-accent-light/10 flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors">
    <span className="min-w-0"><span className="text-text-primary block truncate text-sm font-semibold">{title}</span><span className="text-text-muted mt-0.5 block truncate text-xs">{detail}</span></span>
    <span className="text-text-secondary shrink-0 text-xs tabular-nums">{metric}</span>
  </Link>;
}

export function AdminAnalyticsHub({ overview, period, section = 'overview' }: { overview: Overview; period: AnalyticsPeriod; section?: string }) {
  const t = overview.totals;
  const totalExposures = t.topic_impressions + t.sponsor_served + t.comment_card_impressions;
  const sectionHref = (value: string) => `/admin/analytics?period=${period}&section=${value}`;
  const showAll = section === 'overview';
  const categories = overview.categories.slice(0, showAll ? 5 : 100);
  const topics = overview.topics.slice(0, showAll ? 5 : 100);
  const sponsors = overview.sponsors.slice(0, showAll ? 5 : 100);
  const comments = overview.comments.slice(0, showAll ? 5 : 100);

  return <main className="container py-12">
    <div className="mt-6"><p className="text-accent text-sm font-semibold tracking-wider uppercase">Administration · Insights</p>
      <h1 className="mt-2 text-4xl font-extrabold md:text-5xl">Analytics</h1>
      <p className="text-text-secondary mt-4 max-w-3xl">A unified view of learning activity, community engagement and sponsored delivery. Select any area to explore its performance in detail.</p>
    </div>
    <div className="mt-8"><AdminNavigation /></div>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">{section === 'overview' ? 'Overall performance' : section[0]?.toUpperCase() + section.slice(1)}</h2>
        <p className="text-text-muted mt-1 text-sm">Reporting window · {periods.find((item) => item.value === period)?.label}</p></div>
      <div className="flex flex-wrap gap-2" aria-label="Analytics date range">
        {periods.map((item) => <Button key={item.value} asChild size="sm" variant={period === item.value ? 'primary' : 'secondary'}>
          <Link href={`/admin/analytics?period=${item.value}&section=${section}`} aria-current={period === item.value ? 'page' : undefined}>{item.label}</Link>
        </Button>)}
      </div>
    </div>
    <nav aria-label="Analytics views" className="mt-5 flex flex-wrap gap-2">
      {[
        ['overview','Overall'],['categories','Categories'],['topics','Topics'],['sponsors','Sponsors'],['comments','Comments'],
      ].map(([value,label]) => <Button key={value} asChild size="sm" variant={section === value ? 'primary' : 'secondary'}>
        <Link href={sectionHref(value)} aria-current={section === value ? 'page' : undefined}>{label}</Link>
      </Button>)}
    </nav>

    <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total feed exposures" value={number(totalExposures)} detail="Topic impressions + sponsor deliveries + comment-card impressions" icon={Activity} />
      <Metric label="Topic impressions" value={number(t.topic_impressions)} detail={number(t.topic_viewable_impressions) + ' viewable · ' + duration(t.topic_active_duration_ms) + ' active time'} icon={BookOpen} />
      <Metric label="Sponsored delivery" value={number(t.sponsor_served)} detail={number(t.sponsor_viewable_impressions) + ' viewable · ' + number(t.sponsor_clicks) + ' clicks'} icon={Megaphone} />
      <Metric label="Top Comments exposure" value={number(t.comment_card_impressions)} detail={number(t.comment_card_viewable_impressions) + ' viewable · ' + number(t.comment_card_opens) + ' discussion opens'} icon={MessageCircle} />
    </section>
    <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Categories" value={number(t.category_count)} detail="All categories in the library" icon={BarChart3} />
      <Metric label="Topics" value={number(t.topic_count)} detail={number(t.topic_completions) + ' recorded completions in range'} icon={BookOpen} />
      <Metric label="Sponsors" value={number(t.sponsor_count)} detail="Sponsor organisations" icon={Users} />
      <Metric label="Comments" value={number(t.comment_count)} detail={number(t.comment_card_skips) + ' Top Comments card skips in range'} icon={Heart} />
    </section>

    <section className="mt-10 grid gap-5 lg:grid-cols-2">
      {(section === 'overview' || section === 'categories') && <SectionCard title="Categories" description="Compare category reach and topic coverage." count={number(t.category_count)} href={sectionHref('categories')} icon={BarChart3}>
        {categories.map((item) => <EntityLink key={item.slug} href={`/categories/${encodeURIComponent(item.slug)}/analytics?period=${period}`} title={item.name} detail={number(item.topic_count) + ' topics'} metric={number(item.impressions) + ' impressions'} />)}
        {categories.length === 0 && <p className="text-text-muted text-sm">No categories available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'topics') && <SectionCard title="Topics" description="Inspect individual learning content and reading behaviour." count={number(t.topic_count)} href={sectionHref('topics')} icon={BookOpen}>
        {topics.map((item) => <EntityLink key={item.id} href={`/topic/${encodeURIComponent(item.slug)}/analytics?period=${period}`} title={item.question} detail={item.category_slug} metric={number(item.impressions) + ' impressions'} />)}
        {topics.length === 0 && <p className="text-text-muted text-sm">No topics available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'sponsors') && <SectionCard title="Sponsors" description="Track paid delivery, viewability and campaign clicks." count={number(t.sponsor_count)} href={sectionHref('sponsors')} icon={Megaphone}>
        {sponsors.map((item) => <EntityLink key={item.id} href={`/admin/analytics/sponsors/${item.id}?period=${period}`} title={item.sponsor_name} detail={item.status + ' · ' + item.campaign_count + ' campaigns'} metric={number(item.served) + ' served'} />)}
        {sponsors.length === 0 && <p className="text-text-muted text-sm">No sponsors available.</p>}
      </SectionCard>}
      {(section === 'overview' || section === 'comments') && <SectionCard title="Comments" description="Measure Top Comments card exposure separately from likes and replies." count={number(t.comment_count)} href={sectionHref('comments')} icon={MessageCircle}>
        {comments.map((item) => <EntityLink key={item.id} href={`/admin/analytics/comments/${item.id}?period=${period}`} title={item.topic_question ?? 'Comment #' + item.id} detail={number(item.likes) + ' likes · ' + number(item.replies) + ' replies'} metric={number(item.impressions) + ' card impressions'} />)}
        {comments.length === 0 && <p className="text-text-muted text-sm">No comments available.</p>}
      </SectionCard>}
    </section>
    <Card padding="md" className="mt-8"><p className="text-text-secondary text-sm">Measurement notes</p>
      <p className="text-text-muted mt-2 text-xs leading-relaxed">Topic feed impressions, sponsor served/viewable/click events and Top Comments card exposures are separate event streams. The combined exposure figure is a cross-surface total, not a unique-user count. Comment likes and replies are shown as community interactions and are not added to feed impressions. Comment-card exposure tracking begins when the new client instrumentation is deployed; historical exposure cannot be reconstructed.</p>
    </Card>
  </main>;
}
