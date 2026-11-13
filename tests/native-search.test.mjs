import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/search.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { topicSearchResultFromDatabase } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('maps ranked public search results for the native and website interfaces', () => {
  const result = topicSearchResultFromDatabase({
    id: 'one',
    slug: 'one',
    category_name: 'Faith',
    question: 'Question',
    answer: 'Answer',
    explanation: 'Explanation',
    catechism_paragraphs: null,
    catechism_text: 'Catechism',
    scripture_reference: 'Reference',
    scripture_text: 'Scripture',
    search_score: 9,
  });
  assert.equal(result.topic.category, 'Faith');
  assert.deepEqual(result.topic.catechism.paragraphs, []);
  assert.equal(result.score, 9);
  assert.throws(() => topicSearchResultFromDatabase({ search_score: 9 }), /Invalid topic/);
});
