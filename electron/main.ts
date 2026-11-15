import { createCapacitorElectronApp } from '@capawesome/capacitor-electron';
import { app, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import config from './capacitor.electron.config';
import { migrateLegacyOfflineDatabases } from './offline-migration';

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/joshuaargent/TS_CathoScroll/releases/latest';
const DOWNLOAD_PAGE_URL = 'https://www.cathoscroll.com/download';

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

function parseStableVersion(version: string): [number, number, number] | null {
  const match = /^v?(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(version.trim());

  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseStableVersion(latest);
  const currentParts = parseStableVersion(current);

  if (!latestParts || !currentParts) return false;

  for (let index = 0; index < latestParts.length; index++) {
    if (latestParts[index] > currentParts[index]) return true;
    if (latestParts[index] < currentParts[index]) return false;
  }

  return false;
}

async function checkForMacOSUpdate(): Promise<void> {
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CathoScroll',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status} while checking for updates.`);
    }

    const release: unknown = await response.json();

    if (
      typeof release !== 'object' ||
      release === null ||
      !('tag_name' in release) ||
      typeof release.tag_name !== 'string'
    ) {
      throw new Error('GitHub returned an invalid latest-release response.');
    }

    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (!isNewerVersion(latestVersion, currentVersion)) return;

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'CathoScroll update available',
      message: 'A newer version of CathoScroll is available.',
      detail: `Version ${latestVersion} is available. You are currently using version ${currentVersion}.`,
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      await shell.openExternal(DOWNLOAD_PAGE_URL);
    }
  } catch (error) {
    console.error('Unable to check for CathoScroll macOS updates:', error);
  }
}

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(() => {
    if (!app.isPackaged) return;

    if (process.platform === 'darwin') {
      void checkForMacOSUpdate();
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.error('Unable to check for CathoScroll updates:', error);
    });
  });

  if (!embeddedConfig.server?.url && !process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL) {
    migrateLegacyOfflineDatabases(app.getPath('userData'));
  }
  createCapacitorElectronApp(config);
} else {
  app.quit();
}
