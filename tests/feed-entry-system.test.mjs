import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/feed-entry-system.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildOrderedFeedSequence } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const topics = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
}));

test('generic card rules preserve topic order and insert cards by cadence and priority', () => {
  const sequence = buildOrderedFeedSequence({
    topics,
    cardRules: [
      {
        id: 'sponsor',
        interval: 10,
        priority: 20,
        createEntry: (topic) => ({ type: 'sponsor', topicId: topic.id }),
      },
      {
        id: 'poll',
        interval: 3,
        priority: 5,
        createEntry: (topic) => ({ type: 'poll', topicId: topic.id }),
      },
      {
        id: 'top-comments',
        interval: 5,
        priority: 10,
        createEntry: (topic) => ({ type: 'top-comments', topicId: topic.id }),
      },
    ],
  });

  assert.deepEqual(
    sequence.boundaries.flatMap((boundary) => boundary.entries)
      .filter((entry) => entry.type === 'topic')
      .map((entry) => entry.topicId),
    topics.map((topic) => topic.id),
  );
  assert.deepEqual(
    sequence.boundaries.find((boundary) => boundary.topicId === '10').entries
      .map((entry) => entry.type),
    ['topic', 'top-comments', 'sponsor'],
  );
  assert.deepEqual(
    sequence.boundaries.find((boundary) => boundary.topicId === '9').entries
      .map((entry) => entry.type),
    ['topic', 'poll'],
  );
  assert.deepEqual(
    sequence.boundaries.filter((boundary) => boundary.entries.some((entry) => entry.type === 'poll'))
      .map((boundary) => boundary.topicId),
    ['3', '6', '9', '12'],
  );
});

test('empty inventory omits only that card while its cadence remains independent', () => {
  const sequence = buildOrderedFeedSequence({
    topics: topics.slice(0, 10),
    cardRules: [
      {
        id: 'poll',
        interval: 5,
        priority: 10,
        createEntry: (topic) => topic.id === '5' ? null : ({ type: 'poll', topicId: topic.id }),
      },
      {
        id: 'sponsor',
        interval: 10,
        priority: 20,
        createEntry: (topic) => ({ type: 'sponsor', topicId: topic.id }),
      },
    ],
  });

  assert.deepEqual(
    sequence.boundaries.find((boundary) => boundary.topicId === '5').entries.map((entry) => entry.type),
    ['topic'],
  );
  assert.deepEqual(
    sequence.boundaries.find((boundary) => boundary.topicId === '10').entries.map((entry) => entry.type),
    ['topic', 'poll', 'sponsor'],
  );
  assert.deepEqual(sequence.cadence, { poll: 0, sponsor: 0 });
});

test('independent cadence can resume across appended topic pages', () => {
  const firstPage = buildOrderedFeedSequence({
    topics: topics.slice(0, 4),
    cardRules: [{
      id: 'event',
      interval: 5,
      priority: 10,
      createEntry: (topic) => ({ type: 'event', topicId: topic.id }),
    }],
  });
  const secondPage = buildOrderedFeedSequence({
    topics: topics.slice(4, 6),
    cardRules: [{
      id: 'event',
      interval: 5,
      priority: 10,
      createEntry: (topic) => ({ type: 'event', topicId: topic.id }),
    }],
    initialCadence: firstPage.cadence,
  });

  assert.deepEqual(secondPage.boundaries[0].entries.map((entry) => entry.type), ['topic', 'event']);
});

test('duplicate rule identifiers, invalid intervals and invalid cadence are rejected', () => {
  const rule = {
    id: 'duplicate',
    interval: 2,
    priority: 1,
    createEntry: () => null,
  };
  assert.throws(() => buildOrderedFeedSequence({
    topics: [],
    cardRules: [rule, rule],
  }), /Duplicate feed card rule id/);
  assert.throws(() => buildOrderedFeedSequence({
    topics: [],
    cardRules: [{ ...rule, id: 'invalid-interval', interval: 0 }],
  }), /positive integer/);
  assert.throws(() => buildOrderedFeedSequence({
    topics: [],
    cardRules: [rule],
    initialCadence: { duplicate: 2 },
  }), /Invalid initial cadence/);
});
