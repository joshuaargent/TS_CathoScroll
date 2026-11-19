import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('account-linked topic and comment telemetry fail closed pending legal approval', async () => {
  const [topicViewer, commentViewer, topicRoute, commentRoute] = await Promise.all([
    read('../src/components/topic/TopicSwipeViewer.tsx'),
    read('../src/components/topic/TopCommentFeedCard.tsx'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
  ]);

  for (const source of [topicViewer, commentViewer]) {
    assert.ok(source.includes("process.env.NEXT_PUBLIC_ACCOUNT_LINKED_FEED_ANALYTICS === 'true'"));
    assert.ok(!source.includes('if (!userId || !active) return;'));
  }
  for (const source of [topicRoute, commentRoute]) {
    assert.ok(source.includes("process.env.ACCOUNT_LINKED_FEED_ANALYTICS_ENABLED !== 'true'"));
    assert.ok(source.includes("}, 410)"));
  }
});

test('site analytics removes content paths and query strings before transmission', async () => {
  const layout = await read('../src/app/layout.tsx');
  assert.ok(layout.includes('beforeSend={redactAnalyticsEvent}'));
  assert.ok(layout.includes("url.pathname = '/'"));
  assert.ok(layout.includes("url.search = ''"));
  assert.ok(layout.includes("url.hash = ''"));
  assert.ok(!layout.includes('<SpeedInsights'));
});

test('analytics DPIA records the unresolved Article 9 decision and signed-out boundary', async () => {
  const assessment = await read('../docs/analytics-data-protection-impact-assessment.md');
  assert.ok(assessment.includes('Article 9'));
  assert.ok(assessment.includes('Signed-out first-party topic-level analytics: not approved.'));
  assert.ok(assessment.includes('not certified by this assessment'));
  assert.ok(assessment.includes('Vercel Web Analytics'));
  assert.ok(assessment.includes('Speed Insights'));
});
