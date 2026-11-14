import { OfflineActivityStore } from '@/lib/offline/activity-store';
import { migrateLegacyActivity } from '@/lib/offline/activity-migration';
import { openNativeDatabases, openPrivateActivityDatabase } from '@/lib/offline/native-database';
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
  return privateStore;
}
