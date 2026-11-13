import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/cached-identity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { cachedIdentityFromSession, identityAfterAuthEvent } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('recovers only the account identity from an expired protected session', () => {
  const session = JSON.stringify({
    access_token: 'synthetic-access-token',
    refresh_token: 'synthetic-refresh-token',
    expires_at: 1,
    user: { id: 'user-id', email: 'user@example.test', user_metadata: { private: 'ignored' } },
  });
  assert.deepEqual(cachedIdentityFromSession(session), {
    id: 'user-id',
    email: 'user@example.test',
  });
  assert.equal(cachedIdentityFromSession(null), null);
});

test('retains cached identity on a failed initial refresh but clears it on sign-out', () => {
  const cached = { id: 'user-id', email: 'user@example.test' };
  assert.deepEqual(identityAfterAuthEvent('INITIAL_SESSION', null, cached), cached);
  assert.equal(identityAfterAuthEvent('SIGNED_OUT', null, cached), null);
  assert.equal(identityAfterAuthEvent('INITIAL_SESSION', null, null), null);
  assert.deepEqual(
    identityAfterAuthEvent(
      'SIGNED_IN',
      { user: { id: 'new-user', email: 'new@example.test', metadata: 'ignored' } },
      cached
    ),
    { id: 'new-user', email: 'new@example.test' }
  );
});

test('does not trust incomplete or corrupt cached sessions', () => {
  assert.throws(
    () => cachedIdentityFromSession('{"access_token":"synthetic-secret",invalid}'),
    (error) =>
      error.message === 'The saved account session is invalid.' &&
      !error.message.includes('synthetic-secret')
  );
  assert.throws(() => cachedIdentityFromSession(JSON.stringify({ user: { id: 'user-id' } })));
  assert.throws(() =>
    cachedIdentityFromSession(
      JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_at: 1,
        user: { id: ' user-id ' },
      })
    )
  );
});
