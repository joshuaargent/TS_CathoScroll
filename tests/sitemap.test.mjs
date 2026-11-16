import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/sitemap.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(
  "import { siteConfig } from '@/lib/constants';",
  "const siteConfig = { url: 'https://example.test' };"
);
const { isSitemapPageInRange } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('accepts only sitemap pages within the current item count', () => {
  assert.equal(isSitemapPageInRange(0, 40_001), true);
  assert.equal(isSitemapPageInRange(1, 40_001), true);
  assert.equal(isSitemapPageInRange(2, 40_001), false);
  assert.equal(isSitemapPageInRange(0, 0), false);
});

test('rejects negative, unsafe and overflowing sitemap page numbers', () => {
  assert.equal(isSitemapPageInRange(-1, 100), false);
  assert.equal(isSitemapPageInRange(Number.MAX_SAFE_INTEGER, 100), false);
  assert.equal(isSitemapPageInRange(0, -1), false);
  assert.equal(isSitemapPageInRange(0, 100, 0), false);
});
