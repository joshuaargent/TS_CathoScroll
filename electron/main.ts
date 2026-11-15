import { createCapacitorElectronApp } from '@capawesome/capacitor-electron';
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import config from './capacitor.electron.config';
import { migrateLegacyOfflineDatabases } from './offline-migration';

const embeddedConfig: { server?: { url?: string } } = JSON.parse(
  readFileSync(join(app.getAppPath(), 'generated', 'capacitor.config.json'), 'utf8')
);

if (embeddedConfig.server?.url) {
  const serverUrl = process.env.CAPACITOR_SERVER_URL || embeddedConfig.server.url;
  const parsedServerUrl = new URL(serverUrl);

  if (parsedServerUrl.protocol !== 'https:') {
    throw new Error('CAPACITOR_SERVER_URL must use HTTPS.');
  }
  process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL ??= parsedServerUrl.toString();
}

if (app.requestSingleInstanceLock()) {
  if (!embeddedConfig.server?.url && !process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL) {
    migrateLegacyOfflineDatabases(app.getPath('userData'));
  }
  createCapacitorElectronApp(config);
} else {
  app.quit();
}
