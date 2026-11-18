import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const [registrySource, cursorSource] = await Promise.all([
  readFile(new URL('../src/lib/feed-entry-registry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/feed-entry-cursor.ts', import.meta.url), 'utf8'),
]);
const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
const compile = (source) => ts.transpileModule(source, options).outputText;
const cursorUrl = `data:text/javascript;base64,${Buffer.from(compile(cursorSource)).toString('base64')}`;
const registryJs = compile(registrySource).replace(
  "from './feed-entry-map'",
  "from './feed-entry-map'"
);
const registryUrl = `data:text/javascript;base64,${Buffer.from(registryJs).toString('base64')}`;
const { getFeedEntryKey, getAdjacentFeedEntry, reconcileFeedEntryCursor } = await import(cursorUrl);
const { registerFeedEntry, renderRegisteredFeedEntry, invokeRegisteredFeedEntryAction } = await import(registryUrl);

const topic = (id) => ({ type: 'topic', topicId: id, topic: { id } });
const comments = (id) => ({ type: 'top-comments', topicId: id, comments: [] });
const sponsor = (id) => ({ type: 'sponsor', topicId: id, status: 'ready', campaigns: [], sessionId: 's' });

test('cursor follows the exact topic, comment, sponsor order in both directions', () => {
  const entries = [topic('1'), topic('2'), comments('2'), sponsor('2'), topic('3')];
  const fromTopic = getAdjacentFeedEntry(entries, 'topic:2', 'next');
  assert.equal(fromTopic?.entry.type, 'top-comments');
  const fromComment = getAdjacentFeedEntry(entries, getFeedEntryKey(fromTopic.entry), 'next');
  assert.equal(fromComment?.entry.type, 'sponsor');
  const backwards = getAdjacentFeedEntry(entries, 'sponsor:2', 'previous');
  assert.equal(backwards?.entry.type, 'top-comments');
  assert.equal(getAdjacentFeedEntry(entries, 'topic:1', 'previous'), null);
});

test('cursor reconciliation retains the active entry across appended pages', () => {
  const entries = [topic('1'), topic('2'), comments('2'), topic('3'), topic('4')];
  assert.deepEqual(reconcileFeedEntryCursor(entries, 'top-comments:2', '2'), {
    key: 'top-comments:2',
    index: 2,
  });
  const appended = [...entries, topic('5')];
  assert.deepEqual(reconcileFeedEntryCursor(appended, 'top-comments:2', '2'), {
    key: 'top-comments:2',
    index: 2,
  });
});

test('removed card inventory falls back to its original topic anchor', () => {
  const entries = [topic('1'), topic('2'), topic('3')];
  assert.deepEqual(reconcileFeedEntryCursor(entries, 'sponsor:2', '2'), {
    key: 'topic:2',
    index: 1,
  });
});

test('renderer and action registry dispatches a new card type without feed branches', async () => {
  const calls = [];
  const pollRegistration = registerFeedEntry('top-comments', {
    render: (entry) => `render:${entry.topicId}`,
    onNext: (entry) => { calls.push(`next:${entry.topicId}`); },
    onPrevious: (entry) => { calls.push(`previous:${entry.topicId}`); },
  });
  const entry = comments('42');
  assert.equal(renderRegisteredFeedEntry(entry, [pollRegistration], {}), 'render:42');
  await invokeRegisteredFeedEntryAction(entry, 'next', [pollRegistration], {});
  await invokeRegisteredFeedEntryAction(entry, 'previous', [pollRegistration], {});
  assert.deepEqual(calls, ['next:42', 'previous:42']);
});
