import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/offline/catalogue.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OfflineCatalogue } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE categories (slug TEXT PRIMARY KEY, name TEXT, description TEXT, order_index INTEGER);
    CREATE TABLE topics (
      id TEXT PRIMARY KEY, slug TEXT, category_slug TEXT, order_index INTEGER,
      question TEXT, answer TEXT, explanation TEXT, catechism_paragraphs TEXT,
      catechism_text TEXT, scripture_reference TEXT, scripture_text TEXT
    );
    CREATE TABLE catalogue_metadata (singleton INTEGER PRIMARY KEY, category_count INTEGER, topic_count INTEGER);
    INSERT INTO catalogue_metadata VALUES (1, 1, 55);
    INSERT INTO categories VALUES ('faith', 'Faith', 'Description', 1);
  `);
  const insert = db.prepare('INSERT INTO topics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 55; i++) {
    const id = `topic-${String(i).padStart(3, '0')}`;
    insert.run(
      id,
      id,
      'faith',
      1,
      i === 55 ? 'A 100% question' : `Question ${i}`,
      'Answer',
      '',
      '["123"]',
      '',
      'Reference',
      ''
    );
  }
  const adapter = {
    async transaction(callback) {
      return callback({
        async query(sql, values = []) {
          return db.prepare(sql).all(...values);
        },
      });
    },
  };
  return { db, catalogue: new OfflineCatalogue(adapter) };
}

test('pages topics using a stable cursor even when order values are tied', async () => {
  const { db, catalogue } = fixture();
  try {
    const first = await catalogue.topics({ category: 'faith' });
    const second = await catalogue.topics({ category: 'faith', cursor: first.nextCursor });
    assert.equal(first.topics.length, 50);
    assert.equal(second.topics.length, 5);
    assert.equal(new Set([...first.topics, ...second.topics].map((topic) => topic.id)).size, 55);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(first.topics[0].catechism.paragraphs, ['123']);
    assert.equal(first.topics[0].category, 'Faith');
  } finally {
    db.close();
  }
});

test('treats search wildcard characters as literal text', async () => {
  const { db, catalogue } = fixture();
  try {
    const matches = await catalogue.topics({ search: '100%' });
    assert.deepEqual(
      matches.topics.map((topic) => topic.id),
      ['topic-055']
    );
    assert.equal((await catalogue.topics({ search: '_' })).topics.length, 0);
  } finally {
    db.close();
  }
});

test('opens a topic or category by slug without loading the entire catalogue', async () => {
  const { db, catalogue } = fixture();
  try {
    assert.equal((await catalogue.topic('topic-055')).question, 'A 100% question');
    assert.equal((await catalogue.category('faith')).description, 'Description');
    assert.equal(await catalogue.topic('missing'), null);
    assert.equal(await catalogue.category('missing'), null);
    assert.equal(await catalogue.topic("' OR 1=1 --"), null);
    assert.deepEqual(await catalogue.totals(), { categories: 1, topics: 55 });
    assert.equal(await catalogue.categoryTopicCount('faith'), 55);
    assert.equal(await catalogue.categoryTopicCount('missing'), 0);
    await assert.rejects(catalogue.topic(' '), /Invalid/);
  } finally {
    db.close();
  }
});

test('loads saved topic IDs in order while allowing missing catalogue items', async () => {
  const { db, catalogue } = fixture();
  try {
    assert.deepEqual(
      (await catalogue.topicsByIds(['topic-055', 'missing', 'topic-001'])).map((topic) => topic.id),
      ['topic-055', 'topic-001']
    );
    assert.deepEqual(await catalogue.topicsByIds([]), []);
    await assert.rejects(catalogue.topicsByIds(['topic-001', 'topic-001']), /Invalid/);
    await assert.rejects(
      catalogue.topicsByIds(Array.from({ length: 51 }, (_, i) => String(i))),
      /Invalid/
    );
  } finally {
    db.close();
  }
});
