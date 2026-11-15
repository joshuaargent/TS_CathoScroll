import { randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function validateDatabase(file: string): void {
  const hasRollbackJournal = existsSync(file + '-journal');
  if (!hasRollbackJournal) {
    const readOnly = new DatabaseSync(file, { readOnly: true });
    try {
      const result = readOnly.prepare('PRAGMA quick_check(1)').get();
      if (result?.quick_check !== 'ok') {
        throw new Error('The database did not pass its integrity check.');
      }
    } finally {
      readOnly.close();
    }
    return;
  }

  // A hot rollback journal may make a read-only quick_check fail even though
  // SQLite can recover the database. Snapshot the complete file set before
  // allowing SQLite to perform that recovery. If recovery/integrity checking
  // fails, restore the exact original bytes and sidecars.
  const token = randomUUID();
  const originals = [file, ...sqliteSidecars.map((suffix) => file + suffix)];
  const snapshots: Array<[string, string]> = [];
  try {
    for (const original of originals) {
      if (!existsSync(original)) continue;
      const snapshot = `${original}.validation-${token}`;
      copyFileSync(original, snapshot);
      syncFile(snapshot);
      snapshots.push([original, snapshot]);
    }
  } catch (error) {
    for (const [, snapshot] of snapshots) {
      try {
        unlinkSync(snapshot);
      } catch {
        // Preserve the original error; the original database is still untouched.
      }
    }
    throw error;
  }

  try {
    const writable = new DatabaseSync(file);
    try {
      const result = writable.prepare('PRAGMA quick_check(1)').get();
      if (result?.quick_check !== 'ok') {
        throw new Error('The database did not pass its recovery integrity check.');
      }
    } finally {
      writable.close();
    }
  } catch (error) {
    const snapshotByOriginal = new Map(snapshots);
    const restoreErrors: unknown[] = [];
    for (const original of originals) {
      try {
        const snapshot = snapshotByOriginal.get(original);
        if (snapshot) copyFileSync(snapshot, original);
        else if (existsSync(original)) unlinkSync(original);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length) {
      throw new AggregateError(
        [error, ...restoreErrors],
        'SQLite rollback-journal validation failed and the original database could not be fully restored.'
      );
    }
    for (const [, snapshot] of snapshots) {
      try {
        unlinkSync(snapshot);
      } catch {
        // A stale validation copy is harmless; preserve the original failure.
      }
    }
    throw error;
  }

  // Recovery succeeded. The validated database is now authoritative; discard
  // the temporary snapshots, not the recovered database or any remaining WAL.
  for (const [, snapshot] of snapshots) {
    try {
      unlinkSync(snapshot);
    } catch {
      // Keep an orphaned snapshot rather than failing a successful recovery.
    }
  }
}

function syncFile(file: string): void {
  const handle = openSync(file, 'r+');
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

const sqliteSidecars = ['-wal', '-shm', '-journal'];

function preserveDamagedDatabase(file: string, backup: string): Array<[string, string]> {
  const moved: Array<[string, string]> = [];
  const files = [file, ...sqliteSidecars.map((suffix) => file + suffix)];
  try {
    for (const current of files) {
      if (!existsSync(current)) continue;
      const preserved = current === file ? backup : backup + current.slice(file.length);
      renameSync(current, preserved);
      moved.push([current, preserved]);
    }
    return moved;
  } catch (error) {
    const restoreErrors: unknown[] = [];
    for (const [original, preserved] of moved.reverse()) {
      try {
        renameSync(preserved, original);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length) {
      throw new AggregateError([error, ...restoreErrors], 'Unable to preserve or restore the damaged SQLite database.');
    }
    throw error;
  }
}

function restoreDamagedDatabase(moved: Array<[string, string]>): void {
  const errors: unknown[] = [];
  for (const [original, preserved] of [...moved].reverse()) {
    try {
      if (existsSync(preserved)) renameSync(preserved, original);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Unable to restore the damaged SQLite database and its sidecars.');
  }
}

function preserveCatalogueFallbackFiles(source: string, destination: string): void {
  const moved: Array<[string, string]> = [];
  try {
    if (existsSync(source)) {
      moved.push(...preserveDamagedDatabase(source, `${source}.corrupt-${randomUUID()}`));
    }
    if (existsSync(destination)) {
      moved.push(...preserveDamagedDatabase(destination, `${destination}.corrupt-${randomUUID()}`));
    }
  } catch (error) {
    try {
      restoreDamagedDatabase(moved);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Unable to preserve the damaged catalogue files or restore them.'
      );
    }
    throw error;
  }
}

function hasMeaningfulActivityData(file: string): boolean {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    for (const row of tables) {
      if (typeof row.name !== 'string' || row.name === 'offline_activity_device' || row.name === 'android_metadata') {
        continue;
      }
      const table = `"${row.name.replace(/"/g, '""')}"`;
      if (database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return true;
    }
    return false;
  } finally {
    database.close();
  }
}

function copyValidatedDatabase(source: string, temporary: string): void {
  // A writable open first lets SQLite recover a hot rollback journal or WAL
  // before VACUUM reads the legacy database.
  validateDatabase(source);
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    const result = database.prepare('PRAGMA quick_check(1)').get();
    if (result?.quick_check !== 'ok') {
      throw new Error('The legacy database did not pass its integrity check.');
    }
    database.prepare('VACUUM INTO ?').run(temporary);
  } finally {
    database.close();
  }
  validateDatabase(temporary);
  syncFile(temporary);
}

/**
 * Migrate only the legacy, unencrypted catalogue/activity databases.
 * The encrypted private-activity.sqlite database is deliberately excluded.
 *
 * publish is injectable so interrupted atomic publication can be regression-tested.
 */
export function migrateLegacyOfflineDatabases(
  userData: string,
  publish: (temporary: string, destination: string) => void = renameSync
): void {
  const legacyDirectory = join(userData, 'databases');
  const directory = join(userData, 'cathoscroll-sqlite');

  for (const name of ['catalogue', 'activity']) {
    const source = join(legacyDirectory, `${name}.sqlite`);
    const destination = join(directory, `${name}.sqlite`);
    const sourceExists = existsSync(source);
    const destinationExists = existsSync(destination);

    if (!sourceExists && !destinationExists) continue;

    mkdirSync(directory, { recursive: true });

    let destinationState: 'corrupt' | 'empty' | null = null;
    if (destinationExists) {
      try {
        validateDatabase(destination);
        // A freshly initialised activity database can be structurally valid
        // while containing none of the legacy user's activity. Do not mistake
        // its device-identity row for migrated user data.
        if (name === 'activity' && sourceExists && !hasMeaningfulActivityData(destination)) {
          try {
            validateDatabase(source);
            if (hasMeaningfulActivityData(source)) {
              destinationState = 'empty';
            } else {
              continue;
            }
          } catch {
            // Keep the valid destination if the legacy source cannot be read.
            // The source remains untouched for later recovery/diagnosis.
            continue;
          }
        } else {
          // A valid destination containing user data is authoritative.
          continue;
        }
      } catch (destinationError) {
        destinationState = 'corrupt';
        if (!sourceExists && name !== 'catalogue') {
          throw new Error(
            `The existing ${name} database is corrupt and no legacy source is available.`,
            { cause: destinationError }
          );
        }
        if (!sourceExists && name === 'catalogue') {
          // The Electron plugin can rebuild this public cache from its bundled
          // catalogue, but only if the damaged destination is moved aside.
          preserveCatalogueFallbackFiles(source, destination);
          continue;
        }
      }
    }

    if (!sourceExists) continue;

    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const backup = destinationExists
      ? join(directory, `${name}.sqlite.${destinationState ?? 'previous'}-${randomUUID()}`)
      : null;
    let preservedFiles: Array<[string, string]> = [];

    try {
      try {
        // VACUUM INTO creates a consistent independent copy and never replaces
        // the legacy source.
        copyValidatedDatabase(source, temporary);
      } catch (sourceError) {
        if (name !== 'catalogue') throw sourceError;

        // Catalogue content is rebuildable from the bundled asset. Keep both
        // damaged copies (and their SQLite sidecars) for diagnosis, then let
        // the Electron catalogue installer create a fresh destination.
        preserveCatalogueFallbackFiles(source, destination);
        continue;
      }

      if (backup) preservedFiles = preserveDamagedDatabase(destination, backup);

      try {
        publish(temporary, destination);
      } catch (error) {
        if (preservedFiles.length && !existsSync(destination)) {
          try {
            restoreDamagedDatabase(preservedFiles);
            preservedFiles = [];
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              `Unable to publish or restore the ${name} database.`
            );
          }
        }
        throw error;
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
      // Keep a damaged backup after successful recovery. If publication failed,
      // the backup is moved back into place above.
    }
  }
}
