import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { exportOfflineCatalogue } from '../scripts/export-offline-catalogue.mjs';

async function temporaryOutput(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-catalogue-'));
  const output = path.join(directory, 'catalogue.jsonl');
  t.after(async () => {
    try {
      await unlink(output);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await rmdir(directory);
  });
  return output;
}

function fakeSupabase(pages, overrides = {}) {
  const calls = [];
  const counts = {
    revision: '1',
    categories: String(
      pages.categories.reduce((total, page) => total + (page.data?.length ?? 0), 0)
    ),
    topics: String(pages.topics.reduce((total, page) => total + (page.data?.length ?? 0), 0)),
    ...overrides.counts,
  };
  return {
    calls,
    client: {
      async rpc(name) {
        if (name === 'offline_catalogue_counts') return { data: counts, error: null };
        if (name === 'offline_catalogue_head')
          return { data: { revision: overrides.head ?? counts.revision }, error: null };
        throw new Error(`Unexpected RPC: ${name}`);
      },
      from(table) {
        const call = { table, filters: [], orders: [] };
        calls.push(call);
        const query = {
          select(value) {
            call.select = value;
            return query;
          },
          eq(key, value) {
            call.filters.push([key, value]);
            return query;
          },
          gt(key, value) {
            call.cursor = [key, value];
            return query;
          },
          or(value) {
            call.cursor = value;
            return query;
          },
          order(key) {
            call.orders.push(key);
            return query;
          },
          limit(value) {
            call.limit = value;
            return query;
          },
          then(resolve, reject) {
            return Promise.resolve(pages[table].shift()).then(resolve, reject);
          },
        };
        return query;
      },
    },
  };
}

test('exports bounded public pages with a verified footer and keyset cursor', async (t) => {
  const output = await temporaryOutput(t);
  const topic = (number) => ({
    id: `topic-${String(number).padStart(3, '0')}`,
    slug: `topic-${number}`,
    order_index: 3,
    question: 'Question',
    answer: 'Answer',
    explanation: 'Explanation',
    catechism_paragraphs: [],
    catechism_text: 'Catechism',
    scripture_reference: 'Reference',
    scripture_text: 'Scripture',
    category: { slug: 'faith', name: 'Faith', is_published: true },
  });

  const firstTopics = Array.from({ length: 500 }, (_, index) => topic(index + 1));
  const { client, calls } = fakeSupabase({
    categories: [
      {
        data: [{ slug: 'faith', name: 'Faith', description: 'Faith', order_index: 1 }],
        error: null,
      },
    ],
    topics: [
      { data: firstTopics, error: null },
      { data: [topic(501)], error: null },
    ],
  });

  const result = await exportOfflineCatalogue(client, output);
  const lines = (await readFile(output, 'utf8')).trimEnd().split('\n');
  const footer = JSON.parse(lines.pop());
  const actualHash = createHash('sha256')
    .update(`${lines.join('\n')}\n`)
    .digest('hex');
  assert.deepEqual(result, footer);
  assert.equal(footer.categories, 1);
  assert.equal(footer.topics, 501);
  assert.equal(footer.sha256, actualHash);
  assert.equal(JSON.parse(lines[0]).type, 'header');
  assert.equal(
    calls.find((call) => call.table === 'topics' && call.cursor).cursor,
    'order_index.gt.3,and(order_index.eq.3,id.gt.topic-500)'
  );
  assert(calls.every((call) => call.limit === 500));
  assert(
    calls.every((call) =>
      call.filters.some(([key, value]) => key === 'is_published' && value === true)
    )
  );
  assert(
    calls
      .filter((call) => call.table === 'topics')
      .every((call) =>
        call.filters.some(([key, value]) => key === 'category.is_published' && value === true)
      )
  );
});

test('preserves the previous snapshot when counts or revision change', async (t) => {
  const output = await temporaryOutput(t);
  await writeFile(output, 'previous snapshot');
  for (const overrides of [{ counts: { topics: '1' } }, { head: '2' }]) {
    const { client } = fakeSupabase(
      {
        categories: [{ data: [], error: null }],
        topics: [{ data: [], error: null }],
      },
      overrides
    );
    await assert.rejects(exportOfflineCatalogue(client, output), /changed or was incomplete/);
    assert.equal(await readFile(output, 'utf8'), 'previous snapshot');
    assert.deepEqual(await readdir(path.dirname(output)), ['catalogue.jsonl']);
  }
});

test('does not replace the previous snapshot when export fails', async (t) => {
  const output = await temporaryOutput(t);
  await writeFile(output, 'previous snapshot');
  const { client } = fakeSupabase({
    categories: [{ data: [], error: null }],
    topics: [{ data: null, error: { message: 'database unavailable' } }],
  });

  await assert.rejects(exportOfflineCatalogue(client, output), /database unavailable/);
  assert.equal(await readFile(output, 'utf8'), 'previous snapshot');
  assert.deepEqual(await readdir(path.dirname(output)), ['catalogue.jsonl']);
});

test('paginates categories without an unbounded table read', async (t) => {
  const output = await temporaryOutput(t);
  const category = (number) => ({
    slug: `category-${String(number).padStart(3, '0')}`,
    name: `Category ${number}`,
    description: 'Description',
    order_index: number,
  });
  const { client, calls } = fakeSupabase({
    categories: [
      { data: Array.from({ length: 500 }, (_, index) => category(index + 1)), error: null },
      { data: [category(501)], error: null },
    ],
    topics: [{ data: [], error: null }],
  });

  const result = await exportOfflineCatalogue(client, output);
  assert.equal(result.categories, 501);
  assert.deepEqual(calls.find((call) => call.table === 'categories' && call.cursor).cursor, [
    'slug',
    'category-500',
  ]);
});
