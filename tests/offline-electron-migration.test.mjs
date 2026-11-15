import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'databases'));
  return directory;
}

function createDatabase(file, value) {
  const database = new DatabaseSync(file);
  database.exec(`CREATE TABLE records (value TEXT NOT NULL); INSERT INTO records VALUES ('${value}');`);
  database.close();
}

function readValue(file) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    return database.prepare('SELECT value FROM records').get()?.value;
  } finally {
    database.close();
  }
}

test('repairs a corrupted intermediate destination from a valid legacy source', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  createDatabase(source, 'preserved legacy activity');
  await mkdir(path.dirname(destination));
  const damaged = Buffer.from('damaged destination bytes');
  await writeFile(destination, damaged);

  migrateLegacyOfflineDatabases(directory);

  assert.equal(readValue(destination), 'preserved legacy activity');
  const files = await readdir(path.dirname(destination));
  const backupName = files.find((name) => name.startsWith('activity.sqlite.corrupt-'));
  assert.ok(backupName, 'the damaged destination should be retained after recovery');
  assert.deepEqual(await readFile(path.join(path.dirname(destination), backupName)), damaged);
  assert.equal(readValue(source), 'preserved legacy activity');
});

test('keeps a valid destination when the legacy source is corrupted', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  await mkdir(path.dirname(destination));
  await writeFile(source, 'corrupt legacy source');
  createDatabase(destination, 'valid intermediate');

  migrateLegacyOfflineDatabases(directory);

  assert.equal(readValue(destination), 'valid intermediate');
  assert.equal(await readFile(source, 'utf8'), 'corrupt legacy source');
});

test('preserves both files and reports failure when both databases are corrupted', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  await mkdir(path.dirname(destination));
  await writeFile(source, 'corrupt source');
  await writeFile(destination, 'corrupt destination');

  assert.throws(() => migrateLegacyOfflineDatabases(directory), /database|integrity/i);
  assert.equal(await readFile(source, 'utf8'), 'corrupt source');
  assert.equal(await readFile(destination, 'utf8'), 'corrupt destination');
});

test('restores the damaged destination if atomic publication is interrupted', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  createDatabase(source, 'valid legacy');
  await mkdir(path.dirname(destination));
  const damaged = Buffer.from('damaged destination');
  await writeFile(destination, damaged);

  assert.throws(
    () => migrateLegacyOfflineDatabases(directory, () => { throw new Error('simulated interruption'); }),
    /simulated interruption/
  );

  assert.deepEqual(await readFile(destination), damaged);
  assert.equal(readValue(source), 'valid legacy');
  assert.equal((await readdir(path.dirname(destination))).some((name) => name.endsWith('.tmp')), false);
});

test('does not replace an existing valid destination or lose its data', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  await mkdir(path.dirname(destination));
  createDatabase(source, 'legacy');
  createDatabase(destination, 'already migrated');

  migrateLegacyOfflineDatabases(directory);

  assert.equal(readValue(destination), 'already migrated');
  assert.equal(readValue(source), 'legacy');
  assert.equal((await readdir(path.dirname(destination))).filter((name) => name.includes('.corrupt-')).length, 0);
});

test('never opens or replaces the encrypted private activity database', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  const privateDatabase = path.join(directory, 'cathoscroll-sqlite', 'private-activity.sqlite');
  createDatabase(source, 'legacy');
  await mkdir(path.dirname(destination));
  createDatabase(privateDatabase, 'records', 'encrypted private placeholder');
  const before = await readFile(privateDatabase);

  migrateLegacyOfflineDatabases(directory);

  assert.deepEqual(await readFile(privateDatabase), before);
  assert.equal((await readdir(path.dirname(privateDatabase))).some((name) => name.startsWith('private-activity.sqlite.corrupt-')), false);
});
