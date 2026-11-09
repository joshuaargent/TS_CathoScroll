import { createCapacitorElectronApp } from '@capawesome/capacitor-electron';

import config from './capacitor.electron.config';

const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://cathoscroll.vercel.app';
const parsedServerUrl = new URL(serverUrl);

if (parsedServerUrl.protocol !== 'https:') {
  throw new Error('CAPACITOR_SERVER_URL must use HTTPS.');
}

process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL ??= parsedServerUrl.toString();

createCapacitorElectronApp(config);
