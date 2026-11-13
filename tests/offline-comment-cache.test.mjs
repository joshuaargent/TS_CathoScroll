import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/comment-cache.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OfflineCommentCache } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture(file = ':memory:') {
  const db = new DatabaseSync(file);
  const database = {
    async transaction(callback) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback({
          async execute(sql, values = []) {
            db.prepare(sql).run(...values);
          },
          async query(sql, values = []) {
            return db.prepare(sql).all(...values);
          },
        });

        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, cache: new OfflineCommentCache(database) };
}

function comment(overrides = {}) {
  return {
    id: 1,
    topic_id: 'topic',
    user_id: 'author',
    parent_id: null,
    content: 'Hello',
    created_at: '2026-01-01T00:00:00.000Z',
    edited_at: null,
    is_deleted: false,
    is_pinned: false,
    profile: {
      id: 'author',
      username: 'author',
      display_name: 'Author',
      bio: 'Do not cache',
      created_at: '2026-01-01T00:00:00.000Z',
      subscription_tier: 'premium',
    },
    likes: 3,
    likedByUser: true,
    replies: [],
    ...overrides,
  };
}

test('persists public comment trees without account-specific or deleted content', async () => {
  const { db, cache } = fixture();
  try {
    await cache.initialize();
    assert.equal(await cache.load('topic'), null);
    await cache.save('topic', [
      comment({
        replies: [comment({ id: 2, parent_id: 1, content: 'removed', is_deleted: true })],
      }),
    ]);
    const snapshot = await cache.load('topic');
    assert.equal(snapshot.comments[0].content, 'Hello');
    assert.equal(snapshot.comments[0].likedByUser, false);
    assert.equal(snapshot.comments[0].profile.bio, null);
    assert.equal(snapshot.comments[0].profile.subscription_tier, 'free');
    assert.equal(snapshot.comments[0].replies[0].content, '');
    assert.ok(!Number.isNaN(Date.parse(snapshot.savedAt)));
    assert.equal(await cache.load('other'), null);
    const raw = db.prepare('SELECT comments FROM offline_comment_cache').get().comments;
    assert.ok(!raw.includes('removed'));
    assert.ok(!raw.includes('Do not cache'));
  } finally {
    db.close();
  }
});

test('distinguishes an empty snapshot and preserves it when a later save is invalid', async () => {
  const { db, cache } = fixture();
  try {
    await cache.initialize();
    await cache.save('topic', []);
    assert.deepEqual((await cache.load('topic')).comments, []);
    await assert.rejects(cache.save('topic', [comment({ topic_id: 'other' })]), /Invalid/);
    assert.deepEqual((await cache.load('topic')).comments, []);
    db.prepare('UPDATE offline_comment_cache SET comments = ?').run('{');
    await assert.rejects(cache.load('topic'), SyntaxError);
  } finally {
    db.close();
  }
});

test('comments survive a database reopen', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-comments-'));
  const file = path.join(directory, 'comments.sqlite');
  t.after(async () => {
    await unlink(file);
    await rmdir(directory);
  });
  let { db, cache } = fixture(file);
  await cache.initialize();
  await cache.save('topic', [comment()]);
  db.close();
  ({ db, cache } = fixture(file));
  try {
    await cache.initialize();
    assert.equal((await cache.load('topic')).comments[0].content, 'Hello');
  } finally {
    db.close();
  }
});
