import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../native/note-save-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { nativeNoteSaveKey, updateNativeNoteSaveState } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('completing one topic save does not clear another topic save', () => {
  let state = {};
  state = updateNativeNoteSaveState(state, 'account-one', 'topic-one', true);
  state = updateNativeNoteSaveState(state, 'account-one', 'topic-two', true);

  state = updateNativeNoteSaveState(state, 'account-one', 'topic-one', false);

  assert.equal(state[nativeNoteSaveKey('account-one', 'topic-one')], undefined);
  assert.equal(state[nativeNoteSaveKey('account-one', 'topic-two')], true);
});

test('note save state is isolated by account as well as topic', () => {
  let state = {};
  state = updateNativeNoteSaveState(state, 'account-one', 'topic-one', true);
  state = updateNativeNoteSaveState(state, 'account-two', 'topic-one', true);

  state = updateNativeNoteSaveState(state, 'account-one', 'topic-one', false);

  assert.equal(state[nativeNoteSaveKey('account-one', 'topic-one')], undefined);
  assert.equal(state[nativeNoteSaveKey('account-two', 'topic-one')], true);
});

test('clearing a completed save preserves unrelated in-flight saves', () => {
  let state = {};
  state = updateNativeNoteSaveState(state, 'account', 'topic-one', true);
  state = updateNativeNoteSaveState(state, 'account', 'topic-two', true);
  state = updateNativeNoteSaveState(state, 'account', 'topic-three', true);

  state = updateNativeNoteSaveState(state, 'account', 'topic-two', false);

  assert.deepEqual(state, {
    [nativeNoteSaveKey('account', 'topic-one')]: true,
    [nativeNoteSaveKey('account', 'topic-three')]: true,
  });
});
