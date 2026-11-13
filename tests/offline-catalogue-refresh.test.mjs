import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/catalogue-refresh.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { CatalogueRefresh } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE categories (slug TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE topics (
      id TEXT PRIMARY KEY NOT NULL, slug TEXT UNIQUE NOT NULL, category_slug TEXT NOT NULL REFERENCES categories(slug),
      order_index INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, explanation TEXT NOT NULL,
      catechism_paragraphs TEXT NOT NULL, catechism_text TEXT NOT NULL, scripture_reference TEXT NOT NULL, scripture_text TEXT NOT NULL
    );
    CREATE TABLE catalogue_metadata (singleton INTEGER PRIMARY KEY, category_count INTEGER, topic_count INTEGER);
    INSERT INTO catalogue_metadata VALUES (1, 1, 1);
    INSERT INTO categories VALUES ('old', 'Old', '', 1);
    INSERT INTO topics VALUES ('old', 'old', 'old', 1, 'Old', '', '', '[]', '', '', '');
  `);
  let tail = Promise.resolve();
  const adapter = {
    transaction(callback) {
      const current = tail.then(async () => {
        db.exec('BEGIN');
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
      });
      tail = current.then(
        () => undefined,
        () => undefined
      );
      return current;
    },
  };
  const categories = [{ slug: 'faith', name: 'Faith', description: '', orderIndex: 1 }];
  const topics = Array.from({ length: 205 }, (_, i) => {
    const id = `topic-${String(i).padStart(3, '0')}`;
    return {
      id,
      slug: id,
      categorySlug: 'faith',
      orderIndex: i,
      question: id,
      answer: 'Answer',
      explanation: '',
      catechismParagraphs: [],
      catechismText: '',
      scriptureReference: '',
      scriptureText: '',
    };
  });
  let revision = '1';
  const transport = {
    async head() {
      return revision;
    },
    async counts() {
      return { revision, categories: categories.length, topics: topics.length };
    },
    async categories(after) {
      return categories.filter((row) => !after || row.slug > after).slice(0, 100);
    },
    async topics(after) {
      return topics.filter((row) => !after || row.id > after).slice(0, 100);
    },
    async changes() {
      return { changes: [], hasMore: false, resetRequired: true };
    },
  };
  return {
    db,
    adapter,
    transport,
    topics,
    setRevision(value) {
      revision = value;
    },
  };
}

test('publishes a multi-page update atomically, removing old topics, and skips unchanged revisions', async () => {
  const { db, adapter, transport, topics } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    const original = transport.topics;
    transport.topics = async (after) => {
      assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
      return original(after);
    };
    assert.equal(await service.refresh(), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, topics.length);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM topics WHERE id = ?').get('old').count,
      0
    );
    assert.equal(db.prepare('SELECT topic_count FROM catalogue_metadata').get().topic_count, 205);
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '1');
    assert.equal(await service.refresh(), false);
  } finally {
    db.close();
  }
});

test('keeps the previous catalogue if the revision changes, a page fails, or content is invalid', async () => {
  const { db, adapter, transport, setRevision, topics } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    const original = transport.topics;
    transport.topics = async (after) => {
      setRevision('2');
      return original(after);
    };
    await assert.rejects(service.refresh(), /changed during/);
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catalogue_sync_state').get().count, 0);
    transport.topics = async () => {
      throw new Error('Network failed');
    };
    await assert.rejects(service.refresh(), /Network failed/);
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
    transport.topics = original;
    topics[0].categorySlug = 'missing';
    await assert.rejects(service.refresh(), /no published category/);
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
    topics[0].categorySlug = 'faith';
    assert.equal(await service.refresh(), true);
    setRevision('1');
    await assert.rejects(service.refresh(), /went backwards/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, 205);
  } finally {
    db.close();
  }
});

test('does not publish an aborted or superseded snapshot', async () => {
  const { db, adapter, transport } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    const other = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    const controller = new AbortController();
    const original = transport.topics;
    transport.topics = async (after) => {
      controller.abort();
      return original(after);
    };
    await assert.rejects(service.refresh(controller.signal), { name: 'AbortError' });
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
    transport.topics = original;
    let release;
    let reached;
    const paused = new Promise((resolve) => {
      reached = resolve;
    });
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const slowTransport = {
      ...transport,
      async topics(after) {
        reached();
        await wait;
        return original(after);
      },
    };
    const slow = new CatalogueRefresh(adapter, slowTransport);
    const pending = slow.refresh();
    await paused;
    assert.equal(await other.refresh(), true);
    release();
    await assert.rejects(pending, /superseded/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, 205);
  } finally {
    db.close();
  }
});

test('handles server page limits and refuses incomplete snapshots', async () => {
  const { db, adapter, transport, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    const original = transport.topics;
    transport.topics = async (after) => {
      return (await original(after)).slice(0, 17);
    };
    assert.equal(await service.refresh(), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, 205);
    const state = db.prepare('SELECT revision FROM catalogue_sync_state').get().revision;
    setRevision('2');
    transport.topics = async (after) => {
      return after ? [] : original(after);
    };
    await assert.rejects(service.refresh(), /incomplete/);
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, state);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, 205);
  } finally {
    db.close();
  }
});

test('rolls back publication if replacing the catalogue fails', async () => {
  const { db, adapter, transport } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    db.exec(`CREATE TRIGGER reject_refresh BEFORE INSERT ON topics
      BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;`);
    await assert.rejects(service.refresh(), /disk write failed/);
    assert.equal(db.prepare('SELECT question FROM topics').get().question, 'Old');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catalogue_sync_state').get().count, 0);
    db.exec('DROP TRIGGER reject_refresh');
    assert.equal(await service.refresh(), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topics').get().count, 205);
  } finally {
    db.close();
  }
});

test('applies bounded incremental changes atomically, including slug swaps and removals', async () => {
  const { db, adapter, transport, topics, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    assert.equal(await service.refresh(), true);
    const changes = [
      {
        revision: '2',
        kind: 'category',
        key: 'faith',
        value: { slug: 'faith', name: 'Updated faith', description: 'Updated', orderIndex: 2 },
      },
      {
        revision: '3',
        kind: 'topic',
        key: 'topic-000',
        value: { ...topics[0], slug: 'topic-001', question: 'Updated question' },
      },
      {
        revision: '4',
        kind: 'topic',
        key: 'topic-001',
        value: { ...topics[1], slug: 'topic-000' },
      },
      { revision: '5', kind: 'topic', key: 'topic-002', value: null },
      {
        revision: '6',
        kind: 'topic',
        key: 'new-topic',
        value: { ...topics[2], id: 'new-topic', slug: 'new-topic' },
      },
    ];
    setRevision('6');
    let calls = 0;
    transport.counts = async () => {
      throw new Error('Unexpected full snapshot');
    };
    transport.categories = async () => {
      throw new Error('Unexpected category download');
    };
    transport.topics = async () => {
      throw new Error('Unexpected topic download');
    };
    transport.changes = async (after, through) => {
      calls++;
      assert.equal(through, '6');
      assert.equal(
        db.prepare("SELECT question FROM topics WHERE id='topic-000'").get().question,
        'topic-000'
      );
      const page = changes.filter((change) => BigInt(change.revision) > BigInt(after)).slice(0, 2);
      return { changes: page, hasMore: page.at(-1).revision !== through, resetRequired: false };
    };
    assert.equal(await service.refresh(), true);
    assert.equal(calls, 3);
    assert.equal(
      db.prepare("SELECT name FROM categories WHERE slug='faith'").get().name,
      'Updated faith'
    );
    assert.equal(
      db.prepare("SELECT question FROM topics WHERE id='topic-000'").get().question,
      'Updated question'
    );
    assert.equal(
      db.prepare("SELECT slug FROM topics WHERE id='topic-001'").get().slug,
      'topic-000'
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM topics WHERE id='topic-002'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM topics WHERE id='new-topic'").get().n, 1);
    assert.equal(db.prepare('SELECT topic_count FROM catalogue_metadata').get().topic_count, 205);
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '6');
  } finally {
    db.close();
  }
});

test('leaves the previous catalogue intact when incremental pages are interrupted, invalid or superseded', async () => {
  const { db, adapter, transport, topics, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    await service.refresh();
    setRevision('3');
    const change = {
      revision: '2',
      kind: 'topic',
      key: 'topic-000',
      value: { ...topics[0], question: 'Changed' },
    };
    transport.changes = async (after) => {
      if (after === '1') return { changes: [change], hasMore: true, resetRequired: false };
      throw new Error('Network failed');
    };
    await assert.rejects(service.refresh(), /Network failed/);
    assert.equal(
      db.prepare("SELECT question FROM topics WHERE id='topic-000'").get().question,
      'topic-000'
    );
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '1');
    transport.changes = async () => ({
      changes: [{ ...change, revision: '3' }],
      hasMore: false,
      resetRequired: false,
    });
    await assert.rejects(service.refresh(), /out of order/);
    transport.changes = async (after) => {
      if (after === '1') return { changes: [change], hasMore: true, resetRequired: false };
      setRevision('4');
      return {
        changes: [{ revision: '3', kind: 'topic', key: 'topic-001', value: null }],
        hasMore: false,
        resetRequired: false,
      };
    };
    await assert.rejects(service.refresh(), /changed during/);
    assert.equal(
      db.prepare("SELECT question FROM topics WHERE id='topic-000'").get().question,
      'topic-000'
    );
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '1');
  } finally {
    db.close();
  }
});

test('uses a fresh snapshot when the change history is no longer available', async () => {
  const { db, adapter, transport, topics, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    await service.refresh();
    topics.splice(0, 1);
    setRevision('2');
    assert.equal(await service.refresh(), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM topics').get().n, 204);
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '2');
  } finally {
    db.close();
  }
});

test('rolls back incremental publication when a topic references a missing category', async () => {
  const { db, adapter, transport, topics, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    await service.refresh();
    db.exec('PRAGMA foreign_keys = OFF');
    setRevision('2');
    transport.changes = async () => ({
      changes: [
        {
          revision: '2',
          kind: 'topic',
          key: 'topic-000',
          value: { ...topics[0], categorySlug: 'missing' },
        },
      ],
      hasMore: false,
      resetRequired: false,
    });
    await assert.rejects(service.refresh(), /no published category/);
    assert.equal(
      db.prepare("SELECT category_slug FROM topics WHERE id='topic-000'").get().category_slug,
      'faith'
    );
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '1');
  } finally {
    db.close();
  }
});

test('falls back to a snapshot when the incremental page limit is reached', async () => {
  const { db, adapter, transport, topics, setRevision } = fixture();
  try {
    const service = new CatalogueRefresh(adapter, transport);
    await service.initialize();
    await service.refresh();
    setRevision('102');
    let pages = 0;
    transport.changes = async (after) => {
      pages++;
      return {
        changes: [
          {
            revision: String(Number(after) + 1),
            kind: 'topic',
            key: topics[0].id,
            value: topics[0],
          },
        ],
        hasMore: true,
        resetRequired: false,
      };
    };
    assert.equal(await service.refresh(), true);
    assert.equal(pages, 100);
    assert.equal(db.prepare('SELECT revision FROM catalogue_sync_state').get().revision, '102');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM topics').get().n, 205);
  } finally {
    db.close();
  }
});
