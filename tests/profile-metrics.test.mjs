import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/profile-metrics.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { calculateStreaks } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('calculates current and longest streaks independently of row order and duplicates', () => {
  const now = new Date(2026, 10, 15, 12);
  assert.deepEqual(
    calculateStreaks([
      '2026-11-13T09:00:00',
      '2026-11-15T09:00:00',
      '2026-11-14T10:00:00',
      '2026-11-14T13:00:00',
    ], now),
    { current: 3, longest: 3 }
  );
});

test('keeps a yesterday streak but resets a streak with a two-day gap', () => {
  const now = new Date(2026, 10, 15, 12);
  assert.deepEqual(calculateStreaks(['2026-11-14T10:00:00'], now), {
    current: 1,
    longest: 1,
  });
  assert.deepEqual(
    calculateStreaks(['2026-11-12T10:00:00', '2026-11-11T10:00:00'], now),
    { current: 0, longest: 2 }
  );
});

test('ignores invalid dates and handles empty activity', () => {
  const now = new Date(2026, 10, 15, 12);
  assert.deepEqual(calculateStreaks([], now), { current: 0, longest: 0 });
  assert.deepEqual(calculateStreaks(['not-a-date'], now), { current: 0, longest: 0 });
});
