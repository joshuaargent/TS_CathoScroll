import type { OfflineDatabase } from '@/lib/offline/activity-store';
import { authStorageKey } from './secure-auth-storage';

const keyName = `${authStorageKey}-notes-key`;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CachedNote {
  content: string | null;
  savedAt: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function validateId(value: string): void {
  if (!value || value.trim() !== value) throw new Error('Invalid note account or topic.');
}

export class NativeNoteCache {
  private keys: Promise<{ encryption: CryptoKey; index: CryptoKey }> | null = null;

  constructor(
    private readonly database: OfflineDatabase,
    private readonly storage: SecureStorage
  ) {}

  async initialize(): Promise<void> {
    await this.database.transaction((db) =>
      db.execute(`CREATE TABLE IF NOT EXISTS offline_private_notes (
        note_key TEXT PRIMARY KEY NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL
      )`)
    );
  }

  private async getKeys(): Promise<{ encryption: CryptoKey; index: CryptoKey }> {
    if (!this.keys) {
      this.keys = this.loadKeys().catch((error: unknown) => {
        this.keys = null;
        throw error;
      });
    }
    return this.keys;
  }

  private async loadKeys(): Promise<{ encryption: CryptoKey; index: CryptoKey }> {
    let encoded = await this.storage.getItem(keyName);
    if (encoded === null) {
      const hasNotes = await this.database.transaction(async (db) => {
        const rows = await db.query('SELECT 1 FROM offline_private_notes LIMIT 1');
        return rows.length > 0;
      });
      if (hasNotes) throw new Error('The saved notes encryption key is unavailable.');
      encoded = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
      await this.storage.setItem(keyName, encoded);
    }
    const raw = base64ToBytes(encoded);
    if (raw.length !== 32) throw new Error('Invalid saved notes encryption key.');
    const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const salt = encoder.encode('CathoScroll offline notes v1');
    const encryption = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('encryption') },
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const index = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('index') },
      master,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign']
    );
    raw.fill(0);
    return { encryption, index };
  }

  private async noteKey(userId: string, topicId: string, key: CryptoKey): Promise<string> {
    validateId(userId);
    validateId(topicId);
    const data = encoder.encode(JSON.stringify([userId, topicId]));
    return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, data)));
  }

  async save(userId: string, topicId: string, content: string | null): Promise<void> {
    if (content !== null && typeof content !== 'string') throw new Error('Invalid note content.');
    await this.load(userId, topicId);
    const keys = await this.getKeys();
    const noteKey = await this.noteKey(userId, topicId, keys.index);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(
      JSON.stringify({ userId, topicId, content, savedAt: new Date().toISOString() })
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(noteKey) },
      keys.encryption,
      plaintext
    );
    await this.database.transaction((db) =>
      db.execute('INSERT OR REPLACE INTO offline_private_notes VALUES (?, ?, ?)', [
        noteKey,
        bytesToBase64(nonce),
        bytesToBase64(new Uint8Array(ciphertext)),
      ])
    );
  }

  async load(userId: string, topicId: string): Promise<CachedNote | null> {
    const keys = await this.getKeys();
    const noteKey = await this.noteKey(userId, topicId, keys.index);
    const rows = await this.database.transaction((db) =>
      db.query('SELECT nonce, ciphertext FROM offline_private_notes WHERE note_key = ?', [noteKey])
    );
    if (!rows.length) return null;
    if (
      rows.length !== 1 ||
      typeof rows[0].nonce !== 'string' ||
      typeof rows[0].ciphertext !== 'string'
    ) {
      throw new Error('Invalid saved note.');
    }
    const nonce = base64ToBytes(rows[0].nonce);
    if (nonce.length !== 12) throw new Error('Invalid saved note.');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(noteKey) },
      keys.encryption,
      base64ToBytes(rows[0].ciphertext)
    );
    const note: unknown = JSON.parse(decoder.decode(plaintext));
    if (!note || typeof note !== 'object') throw new Error('Invalid saved note.');
    const value = note as Record<string, unknown>;
    if (
      value.userId !== userId ||
      value.topicId !== topicId ||
      (typeof value.content !== 'string' && value.content !== null) ||
      typeof value.savedAt !== 'string' ||
      Number.isNaN(Date.parse(value.savedAt))
    ) {
      throw new Error('Invalid saved note.');
    }
    return { content: value.content, savedAt: value.savedAt };
  }
}
