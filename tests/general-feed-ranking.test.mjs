import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('signed-out home feed uses the general ranking RPC', () => {
  const page = read('../src/app/page.tsx');
  assert.match(page, /getPublicGeneralTopicPage\(null, 50\)/);
  assert.match(page, /generalRanked/);
  assert.doesNotMatch(page, /getPublishedTopicPage/);
});

test('general feed API validates cursors and uses the ranked page loader', () => {
  const route = read('../src/app/api/content/general-feed/route.ts');
  assert.match(route, /getPublicGeneralTopicPage/);
  assert.match(route, /readBoundedJson/);
  assert.match(route, /checkTrustedIpRateLimit/);
  assert.match(route, /Invalid general-feed cursor/);
});

test('public general ranking is aggregate-based and avoids account history', () => {
  const bootstrap = read('../docs/cathoscroll-database-bootstrap.sql');
  const fnStart = bootstrap.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_public_general_topic_page');
  assert.ok(fnStart >= 0, 'emergency bootstrap includes the public ranking function');
  const fn = bootstrap.slice(fnStart);
  assert.match(fn, /catho_private\.feed_analytics_daily/);
  assert.match(fn, /viewable_impressions/);
  assert.match(fn, /completions/);
  assert.match(fn, /active_duration_ms/);
  assert.match(fn, /skips/);
  assert.match(fn, /public\.topic_likes/);
  assert.match(fn, /public\.bookmarks/);
  assert.match(fn, /public\.comments/);
  assert.doesNotMatch(fn, /auth\.uid\(\)|public\.progress/);
  assert.match(fn, /streak >= 2/);
});

test('general-ranked public feed does not locally shuffle server-ranked pages', () => {
  const core = read('../src/components/topic/TopicFeedCore.tsx');
  assert.match(core, /personalized \|\| generalRanked \? topics : shuffle\(topics\)/);
  assert.match(core, /personalized \|\| generalRanked \? result\.topics : shuffle\(result\.topics\)/);
});
