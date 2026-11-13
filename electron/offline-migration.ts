import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function migrateLegacyOfflineDatabases(userData: string): void {
  const legacyDirectory = join(userData, 'databases');
  const directory = join(userData, 'cathoscroll-sqlite');
  for (const name of ['catalogue', 'activity']) {
    const source = join(legacyDirectory, `${name}.sqlite`);
    const destination = join(directory, `${name}.sqlite`);
    if (!existsSync(source) || existsSync(destination)) continue;
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    try {
      const database = new DatabaseSync(source);
      try {
        if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
          throw new Error(`The old ${name} database did not pass its integrity check.`);
        }
        database.prepare('VACUUM INTO ?').run(temporary);
      } finally {
        database.close();
      }
      const handle = openSync(temporary, 'r+');
      try {
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      try {
        linkSync(temporary, destination);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
