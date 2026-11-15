import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/note-operations.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { loadNativeNote, saveNativeNote } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

function client(user, saveError = null) {
  const writes = [];
  return {
    writes,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      assert.equal(table, 'notes');
      return {
        async upsert(value, options) {
          writes.push({ value, options });
          return { error: saveError };
        },
      };
    },
  };
}

test('saves notes only for the verified active account', async () => {
  const api = client({ id: 'user-1' });
  await saveNativeNote(api, 'user-1', 'topic-1', 'My note');
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].value.user_id, 'user-1');
  assert.equal(api.writes[0].value.topic_id, 'topic-1');
  assert.equal(api.writes[0].value.content, 'My note');
  assert.equal(api.writes[0].options.onConflict, 'user_id,topic_id');
});

test('does not save for a changed account and reports server failures', async () => {
  const changed = client({ id: 'user-2' });
  await assert.rejects(saveNativeNote(changed, 'user-1', 'topic-1', 'Note'), /account changed/);
  assert.equal(changed.writes.length, 0);
  const failed = client({ id: 'user-1' }, { message: 'denied' });
  await assert.rejects(saveNativeNote(failed, 'user-1', 'topic-1', 'Note'), /Unable to save/);
});


test('repairs an unreadable cached note after a successful online refresh', async () => {
  const saved = [];
  const cache = {
    async load() {
      throw new Error('Corrupted cached ciphertext');
    },
    async save(userId, topicId, content) {
      saved.push({ userId, topicId, content });
    },
  };
  let cachedState;
  const result = await loadNativeNote(
    cache,
    'user-1',
    'topic-1',
    async () => 'Fresh note from Supabase',
    (note, warning) => {
      cachedState = { note, warning };
    }
  );

  assert.deepEqual(cachedState, {
    note: null,
    warning: 'Your saved note could not be opened on this device.',
  });
  assert.equal(result.verified, true);
  assert.equal(result.note.content, 'Fresh note from Supabase');
  assert.equal(result.warning, '');
  assert.deepEqual(saved, [{
    userId: 'user-1',
    topicId: 'topic-1',
    content: 'Fresh note from Supabase',
  }]);
});

test('does not cache an online note after its account/topic request becomes stale', async () => {
  const saved = [];
  const cache = {
    async load() { return null; },
    async save(...args) { saved.push(args); },
  };
  const result = await loadNativeNote(
    cache,
    'user-1',
    'topic-1',
    async () => 'A response that arrived after navigation',
    undefined,
    () => false
  );

  assert.equal(result.verified, false);
  assert.equal(saved.length, 0);
});
