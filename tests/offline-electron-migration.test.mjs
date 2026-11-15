import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  const damagedWal = Buffer.from('damaged wal bytes');
  await writeFile(destination, damaged);
  await writeFile(destination + '-wal', damagedWal);

  migrateLegacyOfflineDatabases(directory);

  assert.equal(readValue(destination), 'preserved legacy activity');
  const files = await readdir(path.dirname(destination));
  const backupName = files.find((name) => name.startsWith('activity.sqlite.corrupt-'));
  assert.ok(backupName, 'the damaged destination should be retained after recovery');
  assert.deepEqual(await readFile(path.join(path.dirname(destination), backupName)), damaged);
  assert.deepEqual(await readFile(path.join(path.dirname(destination), backupName + '-wal')), damagedWal);
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
  const damagedWal = Buffer.from('damaged wal');
  await writeFile(destination, damaged);
  await writeFile(destination + '-wal', damagedWal);

  assert.throws(
    () => migrateLegacyOfflineDatabases(directory, () => { throw new Error('simulated interruption'); }),
    /simulated interruption/
  );

  assert.deepEqual(await readFile(destination), damaged);
  assert.deepEqual(await readFile(destination + '-wal'), damagedWal);
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
  createDatabase(privateDatabase, 'encrypted private placeholder');
  const before = await readFile(privateDatabase);

  migrateLegacyOfflineDatabases(directory);

  assert.deepEqual(await readFile(privateDatabase), before);
  assert.equal((await readdir(path.dirname(privateDatabase))).some((name) => name.startsWith('private-activity.sqlite.corrupt-')), false);
});


test('recovers a hot rollback journal before accepting an existing destination', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  createDatabase(source, 'older legacy data');

  await mkdir(path.dirname(destination));
  const database = new DatabaseSync(destination);
  database.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  const insert = database.prepare('INSERT INTO records (id, value) VALUES (?, ?)');
  for (let index = 1; index <= 1000; index++) {
    insert.run(index, `committed destination row ${index} ${'x'.repeat(900)}`);
  }
  database.close();

  const childScript = `
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(process.argv[1]);
    database.exec('PRAGMA cache_size=10; BEGIN IMMEDIATE;');
    database.prepare('UPDATE records SET value = ?').run('uncommitted replacement');
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ['-e', childScript, destination], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(existsSync(destination + '-journal'), 'the crashed writer should leave a hot rollback journal');

  migrateLegacyOfflineDatabases(directory);

  assert.match(readValue(destination), /^committed destination row 1 /);
  assert.equal(readValue(source), 'older legacy data');
  assert.equal(existsSync(destination + '-journal'), false, 'SQLite recovery should remove the hot journal');
});

test('preserves both damaged catalogue copies and leaves room for bundled recovery', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'catalogue.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'catalogue.sqlite');
  await mkdir(path.dirname(destination));
  await writeFile(source, 'corrupt legacy catalogue');
  await writeFile(destination, 'corrupt intermediate catalogue');
  await writeFile(source + '-journal', 'legacy rollback journal');
  await writeFile(destination + '-wal', 'intermediate wal');

  migrateLegacyOfflineDatabases(directory);

  assert.equal(existsSync(source), false);
  assert.equal(existsSync(destination), false);
  const legacyFiles = await readdir(path.dirname(source));
  const destinationFiles = await readdir(path.dirname(destination));
  const legacyBackup = legacyFiles.find((name) => name.startsWith('catalogue.sqlite.corrupt-'));
  const destinationBackup = destinationFiles.find((name) => name.startsWith('catalogue.sqlite.corrupt-'));
  assert.ok(legacyBackup);
  assert.ok(destinationBackup);
  assert.equal(
    await readFile(path.join(path.dirname(source), legacyBackup + '-journal'), 'utf8'),
    'legacy rollback journal'
  );
  assert.equal(
    await readFile(path.join(path.dirname(destination), destinationBackup + '-wal'), 'utf8'),
    'intermediate wal'
  );
});


test('replaces a structurally valid but empty activity destination from the populated legacy source', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  createDatabase(source, 'legacy user activity');
  await mkdir(path.dirname(destination));
  const database = new DatabaseSync(destination);
  database.exec('CREATE TABLE records (value TEXT NOT NULL);');
  database.close();

  migrateLegacyOfflineDatabases(directory);

  assert.equal(readValue(destination), 'legacy user activity');
  assert.equal(readValue(source), 'legacy user activity');
  const files = await readdir(path.dirname(destination));
  assert.ok(files.some((name) => name.startsWith('activity.sqlite.empty-')));
});

test('treats a device identity without user activity as an empty destination', async (t) => {
  const directory = await fixture(t);
  const source = path.join(directory, 'databases', 'activity.sqlite');
  const destination = path.join(directory, 'cathoscroll-sqlite', 'activity.sqlite');
  const sourceDb = new DatabaseSync(source);
  sourceDb.exec('CREATE TABLE offline_activity (user_id TEXT, topic_id TEXT, kind TEXT, value INTEGER);');
  sourceDb.prepare('INSERT INTO offline_activity VALUES (?, ?, ?, ?)').run('user-1', 'topic-1', 'bookmark', 1);
  sourceDb.close();

  await mkdir(path.dirname(destination));
  const destinationDb = new DatabaseSync(destination);
  destinationDb.exec('CREATE TABLE offline_activity_device (singleton INTEGER PRIMARY KEY, device_id TEXT NOT NULL);');
  destinationDb.prepare('INSERT INTO offline_activity_device VALUES (1, ?)').run('device-id');
  destinationDb.exec('CREATE TABLE offline_activity (user_id TEXT, topic_id TEXT, kind TEXT, value INTEGER);');
  destinationDb.close();

  migrateLegacyOfflineDatabases(directory);

  const result = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(
      result.prepare('SELECT value FROM offline_activity WHERE user_id = ?').get('user-1')?.value,
      1
    );
  } finally {
    result.close();
  }
});
