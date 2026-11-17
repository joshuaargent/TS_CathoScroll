import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/analytics/content-analytics.ts', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const analytics = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function validAnalytics(overrides = {}) {
  return {
    entity_type: 'topic',
    entity_id: 'example-topic',
    range_start: '2026-10-17T00:00:00.000Z',
    range_end: '2026-11-16T00:00:00.000Z',
    first_retained_event_at: '2026-11-16T19:21:25.000Z',
    last_event_at: '2026-11-16T20:00:00.000Z',
    events: {
      impressions: 12,
      viewable_impressions: 9,
      unique_viewers: 7,
      active_seconds: 125.5,
      skips: 3,
      average_slide_depth: 2.4,
      completions: 4,
      average_completion_percent: 85,
      return_visits: 2,
    },
    category_content: null,
    top_topics: [],
    interactions: {
      period: {
        likes: 2,
        bookmarks: 1,
        comments: 3,
        replies: 4,
        comment_likes: 6,
        completed_topics: 5,
      },
      lifetime: {
        likes: 10,
        bookmarks: 8,
        comments: 12,
        replies: 9,
        comment_likes: 16,
        completed_topics: 15,
      },
    },
    series: [
      {
        date: '2026-11-16',
        impressions: 12,
        viewable_impressions: 9,
        unique_viewers: 7,
        active_seconds: 125.5,
      },
    ],
    ...overrides,
  };
}

test('accepts a complete topic analytics aggregate', () => {
  const parsed = analytics.parseContentAnalytics(validAnalytics());
  assert.ok(parsed);
  assert.equal(parsed.entity_type, 'topic');
  assert.equal(parsed.events.impressions, 12);
  assert.equal(parsed.interactions.lifetime.bookmarks, 8);
  assert.equal(parsed.interactions.period.comment_likes, 6);
  assert.equal(parsed.series.length, 1);
});

test('accepts category aggregates and empty telemetry history', () => {
  const parsed = analytics.parseContentAnalytics(
    validAnalytics({
      entity_type: 'category',
      category_content: {
        total_topics: 12,
        published_topics: 10,
        unpublished_topics: 2,
      },
      top_topics: [
        {
          slug: 'example-topic',
          question: 'Example topic?',
          impressions: 10,
          viewable_impressions: 8,
          likes: 4,
          bookmarks: 2,
          comments: 1,
          replies: 3,
          comment_likes: 7,
          completed_topics: 5,
        },
      ],
      first_retained_event_at: null,
      last_event_at: null,
      series: [],
    })
  );
  assert.ok(parsed);
  assert.equal(parsed.entity_type, 'category');
  assert.equal(parsed.last_event_at, null);
  assert.equal(parsed.category_content?.published_topics, 10);
  assert.equal(parsed.top_topics[0]?.slug, 'example-topic');
  assert.deepEqual(parsed.series, []);
});

test('accepts an empty category with no published topics', () => {
  const parsed = analytics.parseContentAnalytics(
    validAnalytics({
      entity_type: 'category',
      category_content: {
        total_topics: 0,
        published_topics: 0,
        unpublished_topics: 0,
      },
      top_topics: [],
      first_retained_event_at: null,
      last_event_at: null,
      series: [],
    })
  );
  assert.ok(parsed);
  assert.equal(parsed.category_content?.total_topics, 0);
  assert.deepEqual(parsed.top_topics, []);
});

test('rejects missing, negative, unsafe or malformed aggregate values', () => {
  const invalid = [
    null,
    {},
    validAnalytics({ entity_type: 'sponsor' }),
    validAnalytics({ range_start: 'yesterday' }),
    validAnalytics({ last_event_at: 'not-a-date' }),
    validAnalytics({ first_retained_event_at: 'not-a-date' }),
    validAnalytics({ events: { impressions: -1 } }),
    validAnalytics({ interactions: { period: {}, lifetime: {} } }),
    validAnalytics({ top_topics: [{ slug: '', question: 'Bad', impressions: 1 }] }),
    validAnalytics({ category_content: { total_topics: -1, published_topics: 0, unpublished_topics: 0 } }),
    validAnalytics({ series: [{ date: '2026-11-16', impressions: -1 }] }),
  ];

  for (const payload of invalid) {
    assert.equal(analytics.parseContentAnalytics(payload), null);
  }
});

test('builds bounded 7, 30, 90 and 180 day ranges', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  for (const [period, days] of [
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['180d', 180],
  ]) {
    const range = analytics.getAnalyticsRange(period, now);
    assert.equal((range.to.getTime() - range.from.getTime()) / 86_400_000, days);
  }
  assert.equal(analytics.isAnalyticsPeriod('180d'), true);
  assert.equal(analytics.isAnalyticsPeriod('365d'), false);
});
