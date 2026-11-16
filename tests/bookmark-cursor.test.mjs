import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/bookmark-cursor.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { decodeBookmarkCursor, encodeBookmarkCursor } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('encodes and decodes a stable timestamp/id bookmark cursor', () => {
  const bookmark = { created_at: '2026-11-15T21:15:30.123456+00:00', topic_id: 'b5f46a76-ef30-4f0d-9b5e-4d02e66f0d61' };
  assert.deepEqual(decodeBookmarkCursor(encodeBookmarkCursor(bookmark)), { createdAt: bookmark.created_at, topicId: bookmark.topic_id });
});

test('rejects malformed, oversized and filter-injection bookmark cursors', () => {
  assert.throws(() => decodeBookmarkCursor('not-a-cursor'), /Invalid bookmark cursor/);
  assert.throws(() => decodeBookmarkCursor('a'.repeat(1025)), /Invalid bookmark cursor/);
  const invalid = Buffer.from(JSON.stringify({ createdAt: '2026-11-15T21:15:30Z,or(id.gt.0)', topicId: 'b5f46a76-ef30-4f0d-9b5e-4d02e66f0d61' })).toString('base64url');
  assert.throws(() => decodeBookmarkCursor(invalid), /Invalid bookmark cursor/);
  assert.throws(() => encodeBookmarkCursor({ created_at: '2026-11-15T21:15:30Z', topic_id: 'not-a-uuid' }), /Cannot encode an invalid bookmark cursor/);
});