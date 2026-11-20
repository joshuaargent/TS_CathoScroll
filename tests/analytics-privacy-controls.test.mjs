import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('signed-in and signed-out analytics require the matching optional consent', async () => {
  const [topicViewer, commentViewer, topicRoute, commentRoute, topicClient, commentClient, anonymousClient] = await Promise.all([
    read('../src/components/topic/TopicSwipeViewer.tsx'),
    read('../src/components/topic/TopCommentFeedCard.tsx'),
    read('../src/app/api/analytics/feed-events/route.ts'),
    read('../src/app/api/analytics/feed-card-events/route.ts'),
    read('../src/lib/feed-analytics-client.ts'),
    read('../src/lib/feed-card-analytics-client.ts'),
    read('../src/lib/anonymous-feed-analytics-client.ts'),
  ]);

  assert.ok(topicViewer.includes('recordAnonymousFeedEvent'));
  assert.ok(commentViewer.includes('recordAnonymousFeedEvent'));
  assert.ok(topicRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(commentRoute.includes('getStoredAnalyticsConsent(user.id)'));
  assert.ok(topicRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(commentRoute.includes('if (!consent.serviceImprovement) return respond(request, { accepted: 0 });'));
  assert.ok(topicClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(commentClient.includes("hasAnalyticsConsent('serviceImprovement', userId)"));
  assert.ok(anonymousClient.includes("hasAnalyticsConsent('serviceImprovement', null)"));
  assert.ok(!anonymousClient.includes('userId'));
});


test('Vercel analytics preserves safe page routes and redacts sensitive content identifiers', async () => {
  const layout = await read('../src/app/layout.tsx');
  const analytics = await read('../src/components/providers/PrivacySafeAnalytics.tsx');
  const speed = await read('../src/components/providers/PrivacySafeSpeedInsights.tsx');
  assert.ok(layout.includes('<PrivacySafeAnalytics />'));
  assert.ok(layout.includes('<PrivacySafeSpeedInsights />'));
  assert.ok(analytics.includes('beforeSend={beforeSend}'));
  assert.ok(analytics.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(analytics.includes('if (loading || !enabled) return null;'));
  assert.ok(analytics.includes('return null;'));
  assert.ok(analytics.includes('redactAnalyticsEvent(event)'));
  assert.ok(analytics.includes('url.search = \'\''));
  assert.ok(analytics.includes('url.hash = \'\''));
  assert.ok(analytics.includes('topic|topics'));
  assert.ok(speed.includes('<SpeedInsights beforeSend={beforeSend} />'));
  assert.ok(speed.includes("hasAnalyticsConsent('serviceImprovement', user?.id ?? null)"));
  assert.ok(speed.includes('if (loading || !enabled) return null;'));
  assert.ok(speed.includes('sanitiseSpeedInsightsEvent(event)'));
  assert.ok(speed.includes('url.search = \'\''));
  assert.ok(speed.includes('topic|topics'));
  assert.ok(layout.includes('<meta name="referrer" content="strict-origin" />'));
});

test('analytics DPIA documents active signed-in analytics, signed-out aggregates and the measured purpose', async () => {
  const assessment = await read('../docs/analytics-data-protection-impact-assessment.md');
  assert.ok(assessment.includes('signed-in'));
  assert.ok(assessment.includes('signed-out'));
  assert.ok(assessment.includes('Article 6'));
  assert.ok(assessment.includes('Those scores are not religious-affiliation labels or classifications, but may reveal interests in sensitive topics'));
  assert.ok(assessment.includes('Article 9'));
  assert.ok(assessment.includes('not a legal opinion'));
});
