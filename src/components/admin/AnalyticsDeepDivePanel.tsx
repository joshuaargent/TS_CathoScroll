import { Activity, BarChart3, BookOpen, Clock3, Repeat2, Users } from 'lucide-react';

import { Card } from '@/components/ui/Card';

export type AnalyticsDeepDiveData = {
  funnel: { impressions: number; viewable_sessions: number; completed_sessions: number; skipped_sessions: number };
  sessions: { sessions: number; average_topic_impressions: number; average_active_seconds: number; average_completions: number; low_engagement_sessions: number; return_visits: number };
  recommendations: { impressions: number; viewable_impressions: number; completions: number; skips: number; return_visits: number; active_duration_ms: number };
  retention: { cohort_date: string; users: number; returned_7d: number; returned_30d: number; retention_7d: number | null; retention_30d: number | null }[];
  categories: { slug: string; name: string; published_topics: number; impressions: number; viewable_impressions: number; completions: number }[];
};

const fmt = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
const pct = (numerator: number, denominator: number) => denominator > 0 ? (numerator / denominator * 100).toFixed(1) + '%' : '—';

function Stat({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return <div className="border-border rounded-xl border p-4">
    <div className="flex items-center justify-between gap-2"><p className="text-text-secondary text-sm font-medium">{label}</p><Icon className="text-text-muted h-4 w-4" aria-hidden="true" /></div>
    <p className="text-text-primary mt-3 text-2xl font-bold tabular-nums">{value}</p>
    <p className="text-text-muted mt-1 text-xs">{detail}</p>
  </div>;
}

export function AnalyticsDeepDivePanel({ data }: { data: AnalyticsDeepDiveData }) {
  const f = data.funnel;
  const s = data.sessions;
  const r = data.recommendations;
  return <section className="mt-10 space-y-5">
    <div>
      <p className="text-accent text-xs font-semibold uppercase tracking-wider">Behaviour and discovery</p>
      <h2 className="mt-1 text-2xl font-bold">Feed quality and retention</h2>
      <p className="text-text-secondary mt-1 text-sm">Aggregated signed-in topic-feed behaviour. These reports do not expose individual user activity.</p>
    </div>
    <Card padding="lg">
      <div className="flex items-center gap-2"><Activity className="text-accent h-5 w-5" /><h3 className="text-lg font-bold">Reading funnel</h3></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Feed impressions" value={fmt(f.impressions)} detail="Topic entries from the feed" icon={BookOpen} />
        <Stat label="Sessions reaching viewability" value={fmt(f.viewable_sessions)} detail={pct(f.viewable_sessions, s.sessions) + ' of feed sessions'} icon={Activity} />
        <Stat label="Sessions with a completion" value={fmt(f.completed_sessions)} detail={pct(f.completed_sessions, s.sessions) + ' of feed sessions'} icon={Repeat2} />
        <Stat label="Sessions with a skip" value={fmt(f.skipped_sessions)} detail={pct(f.skipped_sessions, s.sessions) + ' of feed sessions'} icon={Users} />
      </div>
    </Card>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card padding="lg">
        <div className="flex items-center gap-2"><Clock3 className="text-accent h-5 w-5" /><h3 className="text-lg font-bold">Session quality</h3></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Feed sessions" value={fmt(s.sessions)} detail="Distinct signed-in feed sessions" icon={Users} />
          <Stat label="Average active time" value={fmt(s.average_active_seconds) + ' sec'} detail="Per session, recorded active time" icon={Clock3} />
          <Stat label="Topics per session" value={fmt(s.average_topic_impressions)} detail="Average topic entries" icon={BookOpen} />
          <Stat label="Low-engagement sessions" value={fmt(s.low_engagement_sessions)} detail="Less than three seconds of active time" icon={Activity} />
        </div>
      </Card>
      <Card padding="lg">
        <div className="flex items-center gap-2"><BarChart3 className="text-accent h-5 w-5" /><h3 className="text-lg font-bold">Recommendation outcomes</h3></div>
        <p className="text-text-muted mt-1 text-xs">Feed-origin topic activity, measured after the recommendation is actually entered.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Feed entries" value={fmt(r.impressions)} detail="Observed recommendation exposures" icon={BookOpen} />
          <Stat label="Viewable rate" value={pct(r.viewable_impressions,r.impressions)} detail={fmt(r.viewable_impressions) + ' viewable entries'} icon={Activity} />
          <Stat label="Completion rate" value={pct(r.completions,r.impressions)} detail={fmt(r.completions) + ' completions'} icon={Repeat2} />
          <Stat label="Skip rate" value={pct(r.skips,r.impressions)} detail={fmt(r.skips) + ' early skips'} icon={Users} />
        </div>
        <p className="text-text-muted mt-3 text-xs">This measures outcomes for topics users reached. It is not an A/B test or a candidate-level ranking experiment; unshown candidates are not counted as exposures.</p>
      </Card>
    </div>
    <Card padding="lg">
      <div className="flex items-center gap-2"><Repeat2 className="text-accent h-5 w-5" /><h3 className="text-lg font-bold">Cohort retention</h3></div>
      <p className="text-text-muted mt-1 text-xs">Users grouped by first retained feed impression in the selected reporting window. Recent cohorts may not yet have a full 7- or 30-day observation window.</p>
      {data.retention.length ? <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead><tr className="border-border text-text-muted border-b text-xs"><th className="py-2 pr-4">Cohort</th><th className="py-2 pr-4">Users</th><th className="py-2 pr-4">7-day return</th><th className="py-2">30-day return</th></tr></thead>
          <tbody>{data.retention.map((row) => <tr key={row.cohort_date} className="border-border border-b last:border-0"><td className="py-3 pr-4 tabular-nums">{row.cohort_date}</td><td className="py-3 pr-4 tabular-nums">{fmt(row.users)}</td><td className="py-3 pr-4 tabular-nums">{row.retention_7d === null ? '—' : fmt(row.retention_7d) + '%'}</td><td className="py-3 tabular-nums">{row.retention_30d === null ? '—' : fmt(row.retention_30d) + '%'}</td></tr>)}</tbody>
        </table>
      </div> : <p className="text-text-muted mt-4 text-sm">No mature feed cohorts in this period yet.</p>}
    </Card>
    <Card padding="lg">
      <div className="flex items-center gap-2"><BarChart3 className="text-accent h-5 w-5" /><h3 className="text-lg font-bold">Category discovery</h3></div>
      <p className="text-text-muted mt-1 text-xs">Compare published topic coverage with feed exposure and completions.</p>
      {data.categories.length ? <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="border-border text-text-muted border-b text-xs"><th className="py-2 pr-4">Category</th><th className="py-2 pr-4">Topics</th><th className="py-2 pr-4">Impressions</th><th className="py-2 pr-4">Viewable</th><th className="py-2">Completions</th></tr></thead>
          <tbody>{data.categories.map((row) => <tr key={row.slug} className="border-border border-b last:border-0"><td className="py-3 pr-4 font-medium">{row.name}</td><td className="py-3 pr-4 tabular-nums">{fmt(row.published_topics)}</td><td className="py-3 pr-4 tabular-nums">{fmt(row.impressions)}</td><td className="py-3 pr-4 tabular-nums">{pct(row.viewable_impressions,row.impressions)}</td><td className="py-3 tabular-nums">{fmt(row.completions)}</td></tr>)}</tbody>
        </table>
      </div> : <p className="text-text-muted mt-4 text-sm">No category activity recorded in this period.</p>}
    </Card>
  </section>;
}
