import { randomUUID } from 'node:crypto';
import {
  closeSync,
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
  // Open read-write so SQLite can roll back a hot journal before we classify
  // the database. A read-only quick_check can leave recovery sidecars pending.
  const database = new DatabaseSync(file);
  try {
    const result = database.prepare('PRAGMA quick_check(1)').get();
    if (result?.quick_check !== 'ok') {
      throw new Error('The database did not pass its integrity check.');
    }
  } finally {
    database.close();
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

    if (destinationExists) {
      try {
        validateDatabase(destination);
        // A valid intermediate destination is authoritative. Writable
        // validation has already allowed SQLite to recover pending writes.
        continue;
      } catch (destinationError) {
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
      ? join(directory, `${name}.sqlite.corrupt-${randomUUID()}`)
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
