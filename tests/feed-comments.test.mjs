import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-comments.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const feedComments = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

function validComment(overrides = {}) {
  return {
    comment_id: 123,
    topic_slug: 'example-topic',
    topic_question: 'An example topic?',
    category_name: 'Faith',
    author_display_name: 'Example Author',
    author_username: 'example',
    content: 'A thoughtful comment.',
    content_truncated: false,
    created_at: '2026-11-15T12:00:00.000Z',
    is_pinned: false,
    like_count: 2,
    reply_count: 1,
    ...overrides,
  };
}

test('accepts a complete, bounded public top-comment response', () => {
  const comment = validComment();
  assert.equal(feedComments.isTopFeedComment(comment), true);
  assert.deepEqual(feedComments.parseTopFeedComments({ comments: [comment] }), [comment]);
});

test('rejects malformed identifiers, timestamps, content and engagement counts', () => {
  const invalid = [
    validComment({ comment_id: Number.MAX_SAFE_INTEGER + 1 }),
    validComment({ topic_slug: '' }),
    validComment({ category_name: '' }),
    validComment({ author_display_name: '' }),
    validComment({ author_username: '' }),
    validComment({ content: '' }),
    validComment({ content: 'x'.repeat(601) }),
    validComment({ created_at: 'not-a-date' }),
    validComment({ like_count: -1 }),
    validComment({ reply_count: 1.5 }),
    validComment({ is_pinned: 'false' }),
  ];

  for (const comment of invalid) {
    assert.equal(feedComments.isTopFeedComment(comment), false);
  }
});

test('strips non-public fields before an API response is returned', () => {
  const comment = validComment({
    user_id: 'private-user-id',
    moderation_note: 'private moderation detail',
    reporter_ids: ['private-reporter-id'],
  });

  const publicComment = feedComments.toPublicTopFeedComment(comment);

  assert.equal('user_id' in publicComment, false);
  assert.equal('moderation_note' in publicComment, false);
  assert.equal('reporter_ids' in publicComment, false);
  assert.deepEqual(Object.keys(publicComment).sort(), [
    'author_display_name',
    'author_username',
    'category_name',
    'comment_id',
    'content',
    'content_truncated',
    'created_at',
    'is_pinned',
    'like_count',
    'reply_count',
    'topic_question',
    'topic_slug',
  ]);
});

test('drops invalid entries and never accepts more than five comments', () => {
  const comments = Array.from({ length: 7 }, (_, index) =>
    validComment({ comment_id: index + 1 })
  );
  comments[2] = { ...comments[2], content: '' };

  const result = feedComments.parseTopFeedComments({ comments, generated_at: 'now' });

  assert.equal(result.length, 5);
  assert.deepEqual(result.map((comment) => comment.comment_id), [1, 2, 4, 5, 6]);
  assert.deepEqual(feedComments.parseTopFeedComments({ comments: 'invalid' }), []);
  assert.deepEqual(feedComments.parseTopFeedComments(null), []);
});

test('deprioritises comments already viewed in the current feed session', () => {
  const comments = [validComment({ comment_id: 1 }), validComment({ comment_id: 2 })];
  const unseen = feedComments.getUnseenTopFeedComments(comments, new Set([1]));

  assert.deepEqual(unseen.map((comment) => comment.comment_id), [2]);
  assert.deepEqual(feedComments.getUnseenTopFeedComments(comments, new Set([1, 2])), []);
});

test('inserts a comment card after five topic advances only when inventory exists', () => {
  assert.equal(feedComments.shouldInsertTopCommentCard(0, true), false);
  assert.equal(feedComments.shouldInsertTopCommentCard(3, true), false);
  assert.equal(feedComments.shouldInsertTopCommentCard(4, true), true);
  assert.equal(feedComments.shouldInsertTopCommentCard(4, false), false);
  assert.equal(feedComments.getNextTopCommentCadence(3), 4);
  assert.equal(feedComments.getNextTopCommentCadence(4), 0);
  assert.equal(feedComments.getNextTopCommentCadence(-1), 0);
});
