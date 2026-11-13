import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/offline/supabase-catalogue-transport.ts', import.meta.url),
  'utf8'
);
const timeoutSource = await readFile(
  new URL('../src/lib/offline/request-timeout.ts', import.meta.url),
  'utf8'
);
const timeoutCompiled = ts.transpileModule(timeoutSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(
    "'./request-timeout'",
    `'data:text/javascript;base64,${Buffer.from(timeoutCompiled).toString('base64')}'`
  );
const { SupabaseCatalogueTransport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

function fixture() {
  const calls = [];
  const responses = {
    offline_catalogue_head: { revision: '4' },
    offline_catalogue_counts: { revision: '4', categories: '1', topics: '1' },
    categories: [{ slug: 'faith', name: 'Faith', description: '', order_index: 1 }],
    topics: [
      {
        id: 'one',
        slug: 'one',
        order_index: 1,
        question: 'Question',
        answer: 'Answer',
        explanation: '',
        catechism_paragraphs: null,
        catechism_text: '',
        scripture_reference: '',
        scripture_text: '',
        category: { slug: 'faith', is_published: true },
      },
    ],
  };
  function request(name) {
    const builder = {
      select(...args) {
        calls.push([name, 'select', ...args]);
        return builder;
      },
      eq(...args) {
        calls.push([name, 'eq', ...args]);
        return builder;
      },
      order(...args) {
        calls.push([name, 'order', ...args]);
        return builder;
      },
      limit(...args) {
        calls.push([name, 'limit', ...args]);
        return builder;
      },
      gt(...args) {
        calls.push([name, 'gt', ...args]);
        return builder;
      },
      abortSignal(signal) {
        calls.push([name, 'signal', signal]);
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve({ data: responses[name], error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  const client = {
    rpc(name) {
      calls.push([name, 'rpc']);
      return request(name);
    },
    from(name) {
      calls.push([name, 'from']);
      return request(name);
    },
  };
  return { transport: new SupabaseCatalogueTransport(client), calls, responses };
}

test('reads revision and counts and requests only published keyset pages', async () => {
  const { transport, calls } = fixture();
  assert.equal(await transport.head(), '4');
  assert.deepEqual(await transport.counts(), { revision: '4', categories: 1, topics: 1 });
  assert.equal((await transport.categories('a'))[0].slug, 'faith');
  assert.deepEqual((await transport.topics('a'))[0].catechismParagraphs, []);
  assert.ok(
    calls.some(
      ([name, method, field, value]) =>
        name === 'categories' && method === 'eq' && field === 'is_published' && value === true
    )
  );
  assert.ok(
    calls.some(
      ([name, method, field, value]) =>
        name === 'topics' && method === 'eq' && field === 'category.is_published' && value === true
    )
  );
  assert.ok(
    calls.some(
      ([name, method, field, value]) =>
        name === 'topics' && method === 'gt' && field === 'id' && value === 'a'
    )
  );
  assert.ok(
    calls.some(([name, method, field]) => name === 'topics' && method === 'order' && field === 'id')
  );
});

test('rejects invalid counts, unpublished categories and aborted requests', async () => {
  const { transport, responses } = fixture();
  responses.offline_catalogue_counts.topics = '9007199254740992';
  await assert.rejects(transport.counts(), /Invalid catalogue count/);
  responses.topics[0].category.is_published = false;
  await assert.rejects(transport.topics(null), /unpublished category/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.head(controller.signal), { name: 'AbortError' });
});

test('cancels a request when its caller stops the refresh', async () => {
  let requestSignal;
  const transport = new SupabaseCatalogueTransport({
    rpc() {
      return {
        abortSignal(signal) {
          requestSignal = signal;
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      };
    },
  });
  const controller = new AbortController();
  const pending = transport.head(controller.signal);
  assert.equal(requestSignal.aborted, false);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
});

test('times out a stalled request so a later retry can proceed', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = new SupabaseCatalogueTransport({
    rpc() {
      return {
        abortSignal(signal) {
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      };
    },
  });
  const pending = transport.head();
  context.mock.timers.tick(30000);
  await assert.rejects(pending, /timed out/);
});
