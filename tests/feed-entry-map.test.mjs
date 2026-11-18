import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-entry-map.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildFeedEntryMap, flattenFeedEntryMap } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function topic(id) {
  return { id, categorySlug: 'test', question: `Question ${id}` };
}

function comment(id) {
  return {
    comment_id: id,
    topic_slug: 'test',
    topic_question: `Question ${id}`,
    category_name: 'Test',
    author_display_name: 'Test User',
    author_username: 'test',
    content: `Comment ${id}`,
    content_truncated: false,
    created_at: '2026-11-18T00:00:00.000Z',
    is_pinned: false,
    like_count: 3,
    reply_count: 1,
  };
}

function campaign() {
  return {
    campaign_id: '00000000-0000-4000-8000-000000000001',
    sponsor_name: 'Sponsor',
    campaign_name: 'Campaign',
    headline: 'Headline',
    body: 'Body',
    image_url: null,
    destination_url: 'https://example.com',
    cta_label: 'Learn more',
    disclosure: 'Sponsored',
  };
}

test('precomputes the original topic order with Top Comments every five topics', () => {
  const topics = Array.from({ length: 12 }, (_, index) => topic(String(index + 1)));
  const comments = Array.from({ length: 12 }, (_, index) => comment(index + 1));
  const map = buildFeedEntryMap({
    topics,
    comments,
    seenCommentIds: new Set(),
    userId: null,
  });

  assert.deepEqual(
    map.boundaries.filter((boundary) => boundary.entries.length > 1).map((boundary) => boundary.topicId),
    ['5', '10'],
  );
  assert.deepEqual(
    flattenFeedEntryMap(map).filter((entry) => entry.type === 'topic').map((entry) => entry.topicId),
    topics.map((item) => item.id),
  );
  assert.deepEqual(
    map.boundaries.find((boundary) => boundary.topicId === '5').entries.map((entry) => entry.type),
    ['topic', 'top-comments'],
  );
});

test('colliding tenth-topic boundary is deterministically comment then sponsor', () => {
  const topics = Array.from({ length: 10 }, (_, index) => topic(String(index + 1)));
  const comments = Array.from({ length: 10 }, (_, index) => comment(index + 1));
  const map = buildFeedEntryMap({
    topics,
    comments,
    seenCommentIds: new Set(),
    userId: 'user-1',
  });

  assert.deepEqual(
    map.byTopicId.get('10').entries.map((entry) => entry.type),
    ['topic', 'top-comments', 'sponsor'],
  );
  assert.equal(map.byTopicId.get('10').entries[2].status, 'pending');
});

test('resolved sponsor inventory updates mapping state without changing topic order', () => {
  const topics = Array.from({ length: 10 }, (_, index) => topic(String(index + 1)));
  const results = new Map([[
    '10',
    { campaigns: [campaign()], sessionId: 'placement-session' },
  ]]);
  const map = buildFeedEntryMap({
    topics,
    comments: [],
    seenCommentIds: new Set(),
    userId: 'user-1',
    sponsorResults: results,
  });

  const sponsorEntry = map.byTopicId.get('10').entries.find((entry) => entry.type === 'sponsor');
  assert.equal(sponsorEntry.status, 'ready');
  assert.equal(sponsorEntry.sessionId, 'placement-session');
  assert.equal(sponsorEntry.campaigns.length, 1);
});

test('empty inventory suppresses only the affected interstitial and leaves cadence independent', () => {
  const topics = Array.from({ length: 20 }, (_, index) => topic(String(index + 1)));
  const comments = Array.from({ length: 20 }, (_, index) => comment(index + 1));
  const results = new Map([
    ['10', { campaigns: [], sessionId: null }],
    ['20', { campaigns: [campaign()], sessionId: 'placement-session' }],
  ]);
  const map = buildFeedEntryMap({
    topics,
    comments,
    seenCommentIds: new Set(),
    userId: 'user-1',
    sponsorResults: results,
  });

  assert.deepEqual(map.byTopicId.get('10').entries.map((entry) => entry.type), [
    'topic', 'top-comments', 'sponsor',
  ]);
  assert.equal(map.byTopicId.get('10').entries[2].status, 'empty');
  assert.deepEqual(map.byTopicId.get('15').entries.map((entry) => entry.type), [
    'topic', 'top-comments',
  ]);
  assert.equal(map.byTopicId.get('20').entries.find((entry) => entry.type === 'sponsor').status, 'ready');
});

test('seen comments are not reserved twice and comment groups are capped at five', () => {
  const topics = Array.from({ length: 15 }, (_, index) => topic(String(index + 1)));
  const comments = Array.from({ length: 15 }, (_, index) => comment(index + 1));
  const map = buildFeedEntryMap({
    topics,
    comments,
    seenCommentIds: new Set([1, 2, 3, 4, 5]),
    userId: null,
  });

  const groups = map.boundaries
    .flatMap((boundary) => boundary.entries)
    .filter((entry) => entry.type === 'top-comments');
  assert.equal(groups.length, 2);
  assert.ok(groups.every((entry) => entry.comments.length <= 5));
  assert.deepEqual(groups[0].comments.map((item) => item.comment_id), [6, 7, 8, 9, 10]);
  assert.deepEqual(groups[1].comments.map((item) => item.comment_id), [11, 12, 13, 14, 15]);
});

test('cadence continues modulo interval while inventory is empty and resumes without drift', () => {
  const topics = Array.from({ length: 4 }, (_, index) => topic(String(index + 1)));
  const empty = buildFeedEntryMap({
    topics,
    comments: [],
    seenCommentIds: new Set(),
    userId: null,
  });
  assert.equal(empty.commentCadence, 4);

  const resumed = buildFeedEntryMap({
    topics: [topic('5')],
    comments: [comment(1)],
    seenCommentIds: new Set(),
    userId: null,
    commentCadence: empty.commentCadence,
  });
  assert.deepEqual(resumed.boundaries[0].entries.map((entry) => entry.type), [
    'topic', 'top-comments',
  ]);
});

test('invalid cadence configuration is rejected instead of creating an unstable map', () => {
  assert.throws(() => buildFeedEntryMap({
    topics: [],
    comments: [],
    seenCommentIds: new Set(),
    userId: null,
    commentInterval: 0,
  }), RangeError);
});
