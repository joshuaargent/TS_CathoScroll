import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8');

test('late comment inventory fills only unvisited due boundaries without moving existing cards', () => {
  assert.match(core, /boundaryPosition <= currentTopicPosition/);
  assert.match(core, /boundary\.commentCadenceAfter !== 0/);
  assert.match(core, /const hydratedBoundaries = preservedBoundaries\.map/);
  assert.match(core, /const boundaries = \[\.\.\.hydratedBoundaries, \.\.\.planned\.boundaries\]/);
});

test('preserved sponsor slots receive inventory updates and remain eligible for prefetch', () => {
  assert.match(core, /sponsorResultsByTopicId\.current\.get\(boundary\.topicId\)/);
  assert.match(core, /currentInventory\.campaigns\.length === 0/);
  assert.match(core, /for \(const boundary of boundaries\)/);
  assert.match(core, /const firstSponsor = boundaries/);
});
