import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../electron/offline-migration.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { migrateLegacyOfflineDatabases } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cathoscroll-migration-'));
  t.after(() => rm(directory, { recursive: true }));
  await mkdir(path.join(directory, 'databases'));
  return directory;
}

test('preserves legacy activity and never overwrites an existing migrated database', async (t) => {
  const directory = await fixture(t);
  const oldFile = path.join(directory, 'databases', 'activity.sqlite');
  const newFile = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  const old = new DatabaseSync(oldFile);
  old.exec("CREATE TABLE outbox (id TEXT); INSERT INTO outbox VALUES ('pending');");
  old.close();

  migrateLegacyOfflineDatabases(directory);
  const migrated = new DatabaseSync(newFile);
  assert.equal(migrated.prepare('SELECT id FROM outbox').get().id, 'pending');
  migrated.exec("INSERT INTO outbox VALUES ('new');");
  migrated.close();
  migrateLegacyOfflineDatabases(directory);
  const reopened = new DatabaseSync(newFile);
  assert.equal(reopened.prepare('SELECT count(*) AS count FROM outbox').get().count, 2);
  reopened.close();
  assert.ok((await readFile(oldFile)).length > 0);
});

test('does not publish a corrupt legacy database', async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'databases', 'activity.sqlite'), 'not sqlite');
  assert.throws(() => migrateLegacyOfflineDatabases(directory));
  await assert.rejects(readFile(path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite')), {
    code: 'ENOENT',
  });
});
