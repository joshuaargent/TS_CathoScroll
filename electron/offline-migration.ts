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
  const database = new DatabaseSync(file, { readOnly: true });
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

function copyValidatedDatabase(source: string, temporary: string): void {
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
        // A valid intermediate destination is authoritative. Do not replace it,
        // even if the old source has since become unreadable.
        continue;
      } catch (destinationError) {
        if (!sourceExists && name === 'catalogue') {
          // The Electron catalogue installer can rebuild this public cache from
          // the bundled database when no legacy source remains.
          continue;
        }
        if (!sourceExists) {
          throw new Error(
            `The existing ${name} database is corrupt and no legacy source is available.`,
            { cause: destinationError }
          );
        }
      }
    }

    if (!sourceExists) continue;

    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const backup = destinationExists
      ? join(directory, `${name}.sqlite.corrupt-${randomUUID()}`)
      : null;
    let backedUp = false;

    try {
      // Never modify the source. VACUUM INTO creates a consistent independent copy.
      copyValidatedDatabase(source, temporary);

      if (backup) {
        renameSync(destination, backup);
        backedUp = true;
      }

      try {
        publish(temporary, destination);
      } catch (error) {
        if (backedUp && backup && !existsSync(destination)) {
          try {
            renameSync(backup, destination);
            backedUp = false;
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
      // Keep a damaged backup after a successful recovery. It is not opened by
      // the application and preserves the user's original bytes for diagnosis.
      // If publication failed, the backup is moved back into place above.
    }
  }
}
