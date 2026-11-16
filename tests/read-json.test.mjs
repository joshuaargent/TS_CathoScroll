import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/http/read-json.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readBoundedJson } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('parses valid JSON within the configured byte limit', async () => {
  const request = new Request('https://example.test/api', {
    method: 'POST',
    body: JSON.stringify({ message: 'hello' }),
  });
  const result = await readBoundedJson(request, 1024);
  assert.deepEqual(result, { ok: true, value: { message: 'hello' } });
});

test('rejects a body exceeding the limit even without Content-Length', async () => {
  const request = new Request('https://example.test/api', {
    method: 'POST',
    body: JSON.stringify({ message: 'x'.repeat(100) }),
  });
  const result = await readBoundedJson(request, 32);
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: 'Request body too large',
  });
});

test('rejects a declared oversized body before reading it', async () => {
  const request = new Request('https://example.test/api', {
    method: 'POST',
    headers: { 'Content-Length': '2048' },
    body: '{}',
  });
  const result = await readBoundedJson(request, 1024);
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: 'Request body too large',
  });
});

test('rejects malformed JSON and invalid UTF-8', async () => {
  const malformed = new Request('https://example.test/api', {
    method: 'POST',
    body: '{invalid',
  });
  assert.deepEqual(await readBoundedJson(malformed, 1024), {
    ok: false,
    status: 400,
    error: 'Invalid JSON body',
  });

  const invalidUtf8 = new Request('https://example.test/api', {
    method: 'POST',
    body: new Uint8Array([0xff, 0xfe]),
  });
  assert.deepEqual(await readBoundedJson(invalidUtf8, 1024), {
    ok: false,
    status: 400,
    error: 'Invalid JSON body',
  });
});

test('counts UTF-8 bytes rather than JavaScript characters', async () => {
  const request = new Request('https://example.test/api', {
    method: 'POST',
    body: JSON.stringify({ text: 'é' }),
  });
  const body = JSON.stringify({ text: 'é' });
  const bytes = new TextEncoder().encode(body).byteLength;
  assert.equal((await readBoundedJson(request, bytes)).ok, true);
});
