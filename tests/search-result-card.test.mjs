import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/components/search/SearchResultCard.tsx', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const requireModule = createRequire(import.meta.url);
const loadedModule = { exports: {} };
const localRequire = (name) => {
  if (name === 'next/link') {
    return {
      __esModule: true,
      default: ({ children, ...props }) => React.createElement('a', props, children),
    };
  }
  if (name === '@/components/ui/Badge') {
    return { Badge: ({ children }) => React.createElement('span', null, children) };
  }
  return requireModule(name);
};
runInThisContext(`(function(exports, require, module) { ${compiled}\n})`)(
  loadedModule.exports,
  localRequire,
  loadedModule
);

test('highlights literal search text without treating it as a regular expression', () => {
  const topic = {
    slug: 'test',
    category: 'Faith',
    question: 'What is (faith)?',
    answer: 'A (faith) answer',
    explanation: '',
    catechism: { text: '' },
    scripture: { text: '' },
  };
  const html = renderToStaticMarkup(
    React.createElement(loadedModule.exports.SearchResultCard, { topic, query: '(faith)' })
  );
  assert.equal((html.match(/<mark/g) ?? []).length, 2);
  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      React.createElement(loadedModule.exports.SearchResultCard, { topic, query: '[' })
    )
  );
});
