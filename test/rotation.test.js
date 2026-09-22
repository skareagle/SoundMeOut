import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStory } from '../lib/rotation.js';
import { defaultProgress, recordSession, setCurrentStory, setReads } from '../lib/progress.js';

const pool = ['s2-a', 's2-b', 's2-c', 's2-d'].map((id) => ({ id, step: 2, title: id, lines: [] }));
const prog = (x = {}) => ({ ...defaultProgress(), current_step: 2, ...x });

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

test('empty or missing pool returns null', () => {
  assert.equal(pickStory([], prog(), 2), null);
  assert.equal(pickStory(undefined, prog(), 2), null);
});

test('keeps serving the current story while reads < 3', () => {
  const p = prog({ current_story: { 2: 's2-c' }, reads: { 's2-c': 2 }, seen: ['s2-c'] });
  assert.equal(pickStory(pool, p, 2).id, 's2-c');
});

test('moves on once the current story has 3 reads', () => {
  const p = prog({ current_story: { 2: 's2-c' }, reads: { 's2-c': 3 }, seen: ['s2-c'] });
  assert.notEqual(pickStory(pool, p, 2).id, 's2-c');
});

test('a current story no longer in the pool is dropped', () => {
  const p = prog({ current_story: { 2: 's2-zz' }, reads: { 's2-zz': 1 } });
  assert.equal(pickStory(pool, p, 2).id, 's2-a');
});

test('current_story is per step', () => {
  const p = prog({ current_story: { 1: 's2-c' }, reads: {} });
  assert.equal(pickStory(pool, p, 2).id, 's2-a');
});

test('unseen stories come first, then fewest reads', () => {
  const p = prog({ seen: ['s2-a', 's2-b'], reads: { 's2-a': 1, 's2-b': 0 } });
  assert.equal(pickStory(pool, p, 2).id, 's2-c');
  const all = prog({ seen: ['s2-a', 's2-b', 's2-c', 's2-d'], reads: { 's2-a': 2, 's2-b': 1, 's2-c': 3, 's2-d': 1 } });
  assert.equal(pickStory(pool, all, 2).id, 's2-b'); // b and d tie on 1 read; pool order
  assert.equal(pickStory(pool, all, 2, () => 0.99).id, 's2-d'); // rand breaks the tie
});

test('a story read 3 times is not served until everything else has had 3', () => {
  const p = prog({ seen: ['s2-a', 's2-b', 's2-c', 's2-d'], reads: { 's2-a': 3, 's2-b': 3, 's2-c': 3, 's2-d': 2 } });
  for (const r of [0, 0.3, 0.6, 0.99]) assert.equal(pickStory(pool, p, 2, () => r).id, 's2-d');
});

test('when everything has 3 reads, cycle oldest-first by last session', () => {
  let p = prog({ reads: { 's2-a': 3, 's2-b': 3, 's2-c': 3, 's2-d': 3 } });
  for (const id of ['s2-c', 's2-a', 's2-d', 's2-b', 's2-c']) {
    p = recordSession(p, { story_id: id, step: 2, stumbles: [], date: '2026-09-01' });
  }
  // last reads: a@1, d@2, b@3, c@4 -> a is oldest
  assert.equal(pickStory(pool, p, 2).id, 's2-a');
  // a story with no retained session counts as oldest of all
  const bigger = [...pool, { id: 's2-e' }];
  const p2 = { ...p, seen: [...p.seen, 's2-e'], reads: { ...p.reads, 's2-e': 3 } };
  assert.equal(pickStory(bigger, p2, 2).id, 's2-e');
});

test('never returns last_story if any other story exists', () => {
  // last_story would win every tier: unseen, first in pool
  const p = prog({ last_story: { 2: 's2-a' } });
  for (const r of [0, 0.5, 0.99]) assert.notEqual(pickStory(pool, p, 2, () => r).id, 's2-a');
  const done = prog({ last_story: { 2: 's2-a' }, reads: { 's2-a': 3, 's2-b': 3, 's2-c': 3, 's2-d': 3 }, seen: pool.map((s) => s.id) });
  assert.notEqual(pickStory(pool, done, 2).id, 's2-a');
  // ...but a one-story pool still serves it
  assert.equal(pickStory([pool[0]], p, 2).id, 's2-a');
});

test('a finished current story is not served twice in a row', () => {
  const p = prog({ current_story: { 2: 's2-a' }, seen: pool.map((s) => s.id), reads: { 's2-a': 3, 's2-b': 3, 's2-c': 3, 's2-d': 3 } });
  assert.notEqual(pickStory(pool, p, 2).id, 's2-a');
});

test('a whole rotation through a pool serves each story before repeating', () => {
  let p = prog();
  const order = [];
  for (let i = 0; i < pool.length * 3; i++) {
    const s = pickStory(pool, p, 2);
    if (order.at(-1) !== s.id) order.push(s.id);
    p = setCurrentStory(p, 2, s.id);
    p = setReads(p, s.id, (p.reads[s.id] || 0) + 1);
    p = recordSession(p, { story_id: s.id, step: 2, stumbles: [], date: '2026-09-01' });
  }
  assert.deepEqual(order, ['s2-a', 's2-b', 's2-c', 's2-d']);
  // all have 3 reads: next is the oldest, and never the one just finished
  const next = pickStory(pool, p, 2);
  assert.equal(next.id, 's2-a');
});

test('deterministic and never mutates its inputs', () => {
  const p = deepFreeze(prog({ seen: ['s2-a'], reads: { 's2-a': 1 }, last_story: { 2: 's2-b' } }));
  const frozenPool = deepFreeze(structuredClone(pool));
  const before = JSON.stringify([p, frozenPool]);
  const a = pickStory(frozenPool, p, 2, () => 0.42);
  const b = pickStory(frozenPool, p, 2, () => 0.42);
  assert.equal(a, b);
  assert.equal(JSON.stringify([p, frozenPool]), before);
});
