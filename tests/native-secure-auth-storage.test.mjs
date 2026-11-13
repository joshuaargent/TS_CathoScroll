import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/secure-auth-storage.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fixtures = new Map();
globalThis.__testNativeStorageFixtures = fixtures;

async function fixture(t, platform, plugins) {
  const id = Math.random().toString(36);
  fixtures.set(id, {
    Capacitor: { getPlatform: () => platform },
    registerPlugin: (name) =>
      plugins[name] ??
      new Proxy(
        {},
        {
          get() {
            return async () => {
              throw new Error('Native plugin unavailable');
            };
          },
        }
      ),
  });
  t.after(() => {
    fixtures.delete(id);
  });
  const script = compiled.replace(
    "import { Capacitor, registerPlugin } from '@capacitor/core';",
    `const { Capacitor, registerPlugin } = globalThis.__testNativeStorageFixtures.get('${id}');`
  );
  assert.notEqual(script, compiled);
  return import(
    `data:text/javascript;base64,${Buffer.from(script).toString('base64')}#${Math.random()}`
  );
}

test('refuses browser storage and unavailable native plugins', async (t) => {
  const web = await fixture(t, 'web', {});
  await assert.rejects(web.secureAuthStorage.getItem(web.authStorageKey), /unavailable/);
  await assert.rejects(web.secureAuthStorage.setItem(web.authStorageKey, 'token'), /unavailable/);
  const android = await fixture(t, 'android', {});
  await assert.rejects(android.assertSecureAuthStorageAvailable(), /Native plugin unavailable/);
});

test('checks for a lost Android key before reading or overwriting its ciphertext', async (t) => {
  let writes = 0;
  const native = await fixture(t, 'android', {
    CathoSecureAuthGuard: {
      async verify() {
        throw new Error('Sign-in recovery is required');
      },
    },
    SecureStorage: {
      async internalSetItem() {
        writes++;
      },
    },
  });
  await assert.rejects(native.secureAuthStorage.getItem(native.authStorageKey), /recovery/);
  await assert.rejects(
    native.secureAuthStorage.setItem(native.authStorageKey, 'token'),
    /recovery/
  );
  assert.equal(writes, 0);
});

test('uses the Android native plugin without a web fallback', async (t) => {
  const values = new Map();
  const verified = [];
  const native = await fixture(t, 'android', {
    CathoSecureAuthGuard: {
      async verify({ key }) {
        verified.push(key);
      },
    },
    SecureStorage: {
      async internalSetItem({ prefixedKey, data }) {
        values.set(prefixedKey, data);
      },
      async internalGetItem({ prefixedKey }) {
        return { data: values.get(prefixedKey) ?? null };
      },
      async internalRemoveItem({ prefixedKey }) {
        return { success: values.delete(prefixedKey) };
      },
    },
  });
  await native.assertSecureAuthStorageAvailable();
  await native.secureAuthStorage.setItem(native.authStorageKey, 'synthetic');
  assert.equal(await native.secureAuthStorage.getItem(native.authStorageKey), 'synthetic');
  await native.secureAuthStorage.removeItem(native.authStorageKey);
  assert.deepEqual(verified, Array(4).fill(native.authStorageKey));
  assert.equal(values.size, 0);
});
