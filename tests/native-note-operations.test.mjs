import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/note-operations.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { saveNativeNote } = await import(
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
