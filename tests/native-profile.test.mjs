import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const asUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const username = compile(
  await readFile(new URL('../src/lib/username.ts', import.meta.url), 'utf8')
);
const profile = compile(
  await readFile(new URL('../native/profile.ts', import.meta.url), 'utf8')
).replace("'@/lib/username'", `'${asUrl(username)}'`);
const {
  getNativeProfileStatus,
  createNativeProfile,
  readNativeProfile,
  updateNativeProfile,
  updateNativeEmail,
  updateNativePassword,
} = await import(asUrl(profile));

function fixture({
  actor = 'alice',
  existing = false,
  insertError = null,
  updateError = null,
  updateMissing = false,
  concurrent = false,
  authUpdateError = null,
  authUpdatedUser = undefined,
} = {}) {
  let hasProfile = existing;
  const inserts = [];
  const updates = [];
  const authUpdates = [];
  return {
    inserts,
    updates,
    authUpdates,
    client: {
      auth: {
        async getUser() {
          return {
            data: {
              user: actor
                ? {
                    id: actor,
                    email: 'alice@example.com',
                    user_metadata: { username: '  Alice_1  ' },
                  }
                : null,
            },
            error: null,
          };
        },
        async updateUser(value) {
          authUpdates.push(value);
          return {
            data: { user: authUpdatedUser === undefined ? { id: actor } : authUpdatedUser },
            error: authUpdateError,
          };
        },
      },
      from(table) {
        assert.equal(table, 'profiles');
        return {
          select(columns) {
            return {
              eq(_column, id) {
                assert.equal(id, 'alice');
                return {
                  async maybeSingle() {
                    return {
                      data: hasProfile
                        ? columns === 'id'
                          ? { id }
                          : { username: 'alice', display_name: 'Alice', bio: null }
                        : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          async insert(value) {
            inserts.push(value);
            if (concurrent) hasProfile = true;
            return { error: insertError };
          },
          update(value) {
            updates.push(value);
            return {
              eq(_column, id) {
                assert.equal(id, 'alice');
                return {
                  select() {
                    return {
                      async maybeSingle() {
                        return { data: updateMissing ? null : { id }, error: updateError };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test('requires a verified account and creates a missing profile after confirmation', async () => {
  const { client, inserts } = fixture();
  assert.deepEqual(await getNativeProfileStatus(client, 'alice'), {
    exists: false,
    suggestedUsername: 'alice_1',
  });

  assert.equal(await createNativeProfile(client, 'alice', ' Alice_1 '), 'created');
  assert.deepEqual(inserts, [{ id: 'alice', username: 'alice_1', display_name: 'alice_1' }]);
  const wrongAccount = fixture({ actor: 'bob' });
  await assert.rejects(
    createNativeProfile(wrongAccount.client, 'alice', 'alice_1'),
    /Account does not match/
  );
  assert.equal(wrongAccount.inserts.length, 0);
});

test('updates email and password only for the verified account', async () => {
  const { client, authUpdates } = fixture();
  await updateNativeEmail(client, 'alice', ' NEW@EXAMPLE.COM ');
  await updateNativePassword(client, 'alice', 'correct horse', 'correct horse');
  assert.deepEqual(authUpdates, [{ email: 'new@example.com' }, { password: 'correct horse' }]);

  const wrongAccount = fixture({ actor: 'bob' });
  await assert.rejects(
    updateNativeEmail(wrongAccount.client, 'alice', 'new@example.com'),
    /Account does not match/
  );
  await assert.rejects(
    updateNativePassword(wrongAccount.client, 'alice', 'password1', 'password1'),
    /Account does not match/
  );
  assert.equal(wrongAccount.authUpdates.length, 0);

  const failure = fixture({ authUpdateError: new Error('Reauthentication required') });
  await assert.rejects(
    updateNativePassword(failure.client, 'alice', 'password1', 'password1'),
    /Reauthentication required/
  );
  const missing = fixture({ authUpdatedUser: null });
  await assert.rejects(
    updateNativeEmail(missing.client, 'alice', 'new@example.com'),
    /not confirmed/
  );
});

test('rejects invalid account security changes before sending them', async () => {
  const { client, authUpdates } = fixture();
  await assert.rejects(updateNativeEmail(client, 'alice', ' '), /valid email/);
  await assert.rejects(
    updateNativeEmail(client, 'alice', ' ALICE@example.com '),
    /already your email/
  );
  await assert.rejects(updateNativePassword(client, 'alice', 'short', 'short'), /at least 8/);
  await assert.rejects(
    updateNativePassword(client, 'alice', 'password1', 'password2'),
    /do not match/
  );
  assert.equal(authUpdates.length, 0);
});

test('reads and updates only the verified account profile', async () => {
  const { client, updates } = fixture({ existing: true });
  assert.deepEqual(await readNativeProfile(client, 'alice'), {
    username: 'alice',
    displayName: 'Alice',
    bio: '',
  });
  const result = await updateNativeProfile(client, 'alice', {
    username: ' Alice_1 ',
    displayName: ' Alice ',
    bio: ' ',
  });
  assert.deepEqual(result, {
    status: 'saved',
    profile: { username: 'alice_1', displayName: 'Alice', bio: '' },
  });
  assert.deepEqual(updates, [{ username: 'alice_1', display_name: 'Alice', bio: null }]);
  const missing = fixture({ existing: true, updateMissing: true });
  await assert.rejects(
    updateNativeProfile(missing.client, 'alice', {
      username: 'alice',
      displayName: 'Alice',
      bio: '',
    }),
    /not updated/
  );
  const wrongAccount = fixture({ actor: 'bob', existing: true });
  await assert.rejects(readNativeProfile(wrongAccount.client, 'alice'), /Account does not match/);
  await assert.rejects(
    updateNativeProfile(wrongAccount.client, 'alice', {
      username: 'alice',
      displayName: 'Alice',
      bio: '',
    }),
    /Account does not match/
  );
  assert.equal(wrongAccount.updates.length, 0);
  const taken = fixture({ existing: true, updateError: { code: '23505' } });
  assert.deepEqual(
    await updateNativeProfile(taken.client, 'alice', {
      username: 'alice',
      displayName: 'Alice',
      bio: '',
    }),
    { status: 'taken' }
  );
  await assert.rejects(
    updateNativeProfile(client, 'alice', {
      username: 'alice',
      displayName: 'A',
      bio: '',
    }),
    /Display name/
  );
  await assert.rejects(
    updateNativeProfile(client, 'alice', {
      username: 'alice',
      displayName: 'Alice',
      bio: 'x'.repeat(251),
    }),
    /Bio/
  );
});

test('recovers concurrent profile creation and reports an unavailable username', async () => {
  const existing = fixture({ existing: true });
  assert.equal(await createNativeProfile(existing.client, 'alice', 'alice_1'), 'exists');
  assert.equal(existing.inserts.length, 0);
  const concurrent = fixture({ concurrent: true, insertError: { code: '23505' } });
  assert.equal(await createNativeProfile(concurrent.client, 'alice', 'alice_1'), 'exists');
  const taken = fixture({ insertError: { code: '23505' } });
  assert.equal(await createNativeProfile(taken.client, 'alice', 'alice_1'), 'taken');
});

test('rejects invalid names and surfaces unexpected database errors', async () => {
  const { client, inserts } = fixture();
  await assert.rejects(createNativeProfile(client, 'alice', 'Admin'), /unavailable/);
  await assert.rejects(createNativeProfile(client, 'alice', 'bad name'), /Username must/);
  assert.equal(inserts.length, 0);
  const failure = fixture({ insertError: { code: '42501', message: 'denied' } });
  await assert.rejects(createNativeProfile(failure.client, 'alice', 'alice_1'), { code: '42501' });
});
