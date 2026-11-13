import { Capacitor, registerPlugin } from '@capacitor/core';

export const authStorageKey = 'cathoscroll.auth.v1';

interface AndroidSecureStorage {
  internalGetItem(options: { prefixedKey: string }): Promise<{ data: string | null }>;
  internalSetItem(options: { prefixedKey: string; data: string }): Promise<void>;
  internalRemoveItem(options: { prefixedKey: string }): Promise<{ success: boolean }>;
}

interface DesktopSecureStorage {
  check(): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

interface AndroidSecureAuthGuard {
  verify(options: { key: string }): Promise<void>;
}

const android = registerPlugin<AndroidSecureStorage>('SecureStorage');
const androidGuard = registerPlugin<AndroidSecureAuthGuard>('CathoSecureAuthGuard');
const desktop = registerPlugin<DesktopSecureStorage>('CathoSecureStorage');

function assertKey(key: string) {
  if (
    typeof key !== 'string' ||
    key.length > 256 ||
    (key !== authStorageKey && !key.startsWith(`${authStorageKey}-`)) ||
    !/^[a-zA-Z0-9._-]+$/.test(key)
  ) {
    throw new Error('Invalid secure storage key.');
  }
}

export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    assertKey(key);
    const platform = Capacitor.getPlatform();
    if (platform === 'android') await androidGuard.verify({ key });
    const value =
      platform === 'android'
        ? (await android.internalGetItem({ prefixedKey: key })).data
        : platform === 'electron'
          ? (await desktop.get({ key })).value
          : (() => {
              throw new Error('Secure native storage is unavailable on this platform.');
            })();
    if (value !== null && typeof value !== 'string') {
      throw new Error('Invalid secure storage response.');
    }
    return value;
  },

  async setItem(key: string, value: string): Promise<void> {
    assertKey(key);
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > 1024 * 1024) {
      throw new Error('Invalid secure storage value.');
    }
    const platform = Capacitor.getPlatform();
    if (platform === 'android') {
      await androidGuard.verify({ key });
      await android.internalSetItem({ prefixedKey: key, data: value });
    } else if (platform === 'electron') {
      await desktop.set({ key, value });
    } else {
      throw new Error('Secure native storage is unavailable on this platform.');
    }
  },

  async removeItem(key: string): Promise<void> {
    assertKey(key);
    const platform = Capacitor.getPlatform();
    if (platform === 'android') {
      await androidGuard.verify({ key });
      const result = await android.internalRemoveItem({ prefixedKey: key });
      if (typeof result.success !== 'boolean') throw new Error('Invalid secure storage response.');
    } else if (platform === 'electron') {
      await desktop.remove({ key });
    } else {
      throw new Error('Secure native storage is unavailable on this platform.');
    }
  },
};

export async function assertSecureAuthStorageAvailable(): Promise<void> {
  if (Capacitor.getPlatform() === 'electron') await desktop.check();
  await secureAuthStorage.getItem(authStorageKey);
}
