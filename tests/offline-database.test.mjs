import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { buildOfflineDatabase } from '../scripts/build-offline-database.mjs';

async function testFiles(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-sqlite-'));
  const snapshot = path.join(directory, 'catalogue.jsonl');
  const output = path.join(directory, 'catalogue.sqlite');
  t.after(async () => {
    for (const file of [snapshot, output]) {
      try {
        await unlink(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await rmdir(directory);
  });
  return { directory, snapshot, output };
}

function snapshotText(records, counts = { categories: 1, topics: 1 }) {
  const body = records.map((record) => `${JSON.stringify(record)}\n`).join('');
  const sha256 = createHash('sha256').update(body).digest('hex');
  return `${body}${JSON.stringify({ type: 'footer', ...counts, sha256 })}\n`;
}

function records() {
  return [
    { type: 'header', format: 1, exportedAt: '2026-01-01T00:00:00.000Z' },
    {
      type: 'category',
      category: { slug: 'faith', name: 'Faith', description: 'Description', order_index: 2 },
    },
    {
      type: 'topic',
      topic: {
        id: 'topic-1',
        slug: 'topic-one',
        order_index: 3,
        question: 'Question',
        answer: 'Answer',
        explanation: 'Explanation',
        catechism_paragraphs: ['123'],
        catechism_text: 'Catechism',
        scripture_reference: 'Reference',
        scripture_text: 'Scripture',
        category: { slug: 'faith', name: 'Faith', is_published: true },
      },
    },
  ];
}

test('builds a queryable SQLite catalogue from a verified snapshot', async (t) => {
  const { snapshot, output } = await testFiles(t);
  await writeFile(snapshot, snapshotText(records()));
  const result = await buildOfflineDatabase(snapshot, output);
  const db = new DatabaseSync(output, { readOnly: true });
  try {
    const topic = db
      .prepare(
        'SELECT topics.question, categories.name, topics.catechism_paragraphs FROM topics JOIN categories ON categories.slug = topics.category_slug WHERE topics.slug = ?'
      )
      .get('topic-one');
    assert.equal(topic.question, 'Question');
    assert.equal(topic.name, 'Faith');
    assert.deepEqual(JSON.parse(topic.catechism_paragraphs), ['123']);
    const metadata = db.prepare('SELECT * FROM catalogue_metadata').get();
    assert.equal(metadata.topic_count, 1);
    assert.equal(metadata.category_count, 1);
    assert.equal(metadata.sha256, result.sha256);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
  }
});

test('rejects a corrupt snapshot without replacing the existing database', async (t) => {
  const { directory, snapshot, output } = await testFiles(t);
  await writeFile(snapshot, snapshotText(records()));
  await buildOfflineDatabase(snapshot, output);
  const original = await readFile(output);
  await writeFile(snapshot, snapshotText(records()).replace('Question', 'Changed!'));
  await assert.rejects(buildOfflineDatabase(snapshot, output), /checksum/);
  assert.deepEqual(await readFile(output), original);
  assert.deepEqual((await readdir(directory)).sort(), ['catalogue.jsonl', 'catalogue.sqlite']);
});

test('replaces an existing database after a successful rebuild', async (t) => {
  const { snapshot, output } = await testFiles(t);
  await writeFile(snapshot, snapshotText(records()));
  await buildOfflineDatabase(snapshot, output);
  const updated = records();
  updated[2].topic.question = 'Updated question';
  await writeFile(snapshot, snapshotText(updated));
  await buildOfflineDatabase(snapshot, output);
  const db = new DatabaseSync(output, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Updated question');
  } finally {
    db.close();
  }
});

test('rejects a topic with an inconsistent category', async (t) => {
  const { snapshot, output } = await testFiles(t);
  const source = records();
  source[2].topic.category.name = 'Changed category';
  await writeFile(snapshot, snapshotText(source));
  await assert.rejects(buildOfflineDatabase(snapshot, output), /inconsistent category/);
});

test('rejects a truncated snapshot', async (t) => {
  const { snapshot, output } = await testFiles(t);
  await writeFile(snapshot, snapshotText(records()).slice(0, -1));
  await assert.rejects(buildOfflineDatabase(snapshot, output), /incomplete final line/);
});
