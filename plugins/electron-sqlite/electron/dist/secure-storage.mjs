import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const storagePrefix = 'cathoscroll.auth.v1';
const linuxBackends = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

export class CathoSecureStorage {
  static __capacitorElectronPlugin = {
    name: 'CathoSecureStorage',
    methods: ['check', 'get', 'set', 'remove'],
  };

  constructor(context) {
    this.context = context;
  }

  async check() {
    if (this.context.config.server?.url || process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL) {
      throw new Error('Secure storage is unavailable in the hosted desktop wrapper.');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this device.');
    }
    if (
      process.platform === 'linux' &&
      !linuxBackends.has(safeStorage.getSelectedStorageBackend())
    ) {
      throw new Error('An operating-system secret store is required.');
    }
  }

  fileFor(key) {
    if (
      typeof key !== 'string' ||
      key.length > 256 ||
      (key !== storagePrefix && !key.startsWith(`${storagePrefix}-`)) ||
      !/^[a-zA-Z0-9._-]+$/.test(key)
    ) {
      throw new Error('Invalid secure storage key.');
    }
    const name = createHash('sha256').update(key).digest('hex');
    return path.join(app.getPath('userData'), 'secure-auth', `${name}.bin`);
  }

  async get({ key }) {
    await this.check();
    const file = this.fileFor(key);
    let data;
    try {
      data = readFileSync(file);
    } catch (error) {
      if (error.code === 'ENOENT') return { value: null };
      throw error;
    }
    return { value: safeStorage.decryptString(data) };
  }

  async set({ key, value }) {
    await this.check();
    const file = this.fileFor(key);
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 * 1024) {
      throw new Error('Invalid secure storage value.');
    }
    const encrypted = safeStorage.encryptString(value);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(handle, encrypted);
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  async remove({ key }) {
    await this.check();
    try {
      unlinkSync(this.fileFor(key));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
