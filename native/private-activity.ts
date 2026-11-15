import { OfflineActivityStore } from '@/lib/offline/activity-store';
import { migrateLegacyActivity } from '@/lib/offline/activity-migration';
import { openNativeDatabases, openPrivateActivityDatabase, removeLegacyActivityDatabase } from '@/lib/offline/native-database';
import { secureAuthStorage } from './secure-auth-storage';

let opening: Promise<OfflineActivityStore> | undefined;

export function openPrivateActivity(): Promise<OfflineActivityStore> {
  if (!opening) {
    opening = initialize().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

async function initialize(): Promise<OfflineActivityStore> {
  const legacy = (await openNativeDatabases(secureAuthStorage)).activity;
  const database = await openPrivateActivityDatabase(secureAuthStorage);
  const legacyStore = new OfflineActivityStore(legacy);
  const privateStore = new OfflineActivityStore(database);
  await legacyStore.initialize();
  await privateStore.initialize();
  await migrateLegacyActivity(legacy, database);
  await database.transaction(async (db) => {
    const integrity = await db.query('PRAGMA quick_check(1)');
    const marker = await db.query('SELECT version FROM offline_activity_migration WHERE id = 1');
    if (
      integrity.length !== 1 ||
      integrity[0].quick_check !== 'ok' ||
      marker.length !== 1 ||
      marker[0].version !== 1
    ) {
      throw new Error('The encrypted activity migration could not be verified.');
    }
  });
  // The legacy copy is removed only after the encrypted destination has passed
  // integrity and migration-marker checks. A failed cleanup is retried at startup.
  await removeLegacyActivityDatabase();
  return privateStore;
}
