import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultProgress,
  normalizeProgress,
  recordSession,
  setReads,
  setCurrentStory,
  promote,
  warmupWords,
  readiness,
  MAX_SESSIONS,
} from '../lib/progress.js';
import { buildIndex, heartWords } from '../lib/bank.js';

const DEFAULT = {
  current_step: 1,
  reads: {},
  stumbles: {},
  seen: [],
  step_history: [],
  sessions: [],
  current_story: {},
  last_story: {},
};

test('defaultProgress has the spec shape plus sessions and story maps', () => {
  assert.deepEqual(defaultProgress(), DEFAULT);
});

test('defaultProgress returns a fresh object each time', () => {
  const a = defaultProgress();
  a.seen.push('x');
  a.reads.y = 1;
  assert.deepEqual(defaultProgress(), DEFAULT);
});

test('normalizeProgress never throws and degrades garbage to the default', () => {
  const junk = [undefined, null, 0, 42, true, '', 'not json', '{"broken":', [], [1, 2], () => 1, Symbol('s')];
  for (const x of junk) {
    assert.deepEqual(normalizeProgress(x), DEFAULT, `input: ${String(x)}`);
  }
});

test('normalizeProgress keeps a valid object intact', () => {
  const good = {
    current_step: 3,
    reads: { 's2-91bc': 3, 's3-0f2a': 1 },
    stumbles: { mud: 4, fox: 1 },
    seen: ['s2-91bc', 's2-44de'],
    step_history: [{ step: 2, promoted_at: '2026-09-14' }],
    sessions: [{ story_id: 's2-91bc', step: 2, stumbles: ['mud'], date: '2026-09-15' }],
    current_story: { 3: 's3-0f2a' },
    last_story: { 2: 's2-91bc' },
  };
  assert.deepEqual(normalizeProgress(structuredClone(good)), {
    ...good,
    current_story: { '3': 's3-0f2a' },
    last_story: { '2': 's2-91bc' },
  });
});

test('normalizeProgress parses a JSON string', () => {
  const p = normalizeProgress(JSON.stringify({ current_step: 2, seen: ['a'] }));
  assert.equal(p.current_step, 2);
  assert.deepEqual(p.seen, ['a']);
});

test('normalizeProgress drops wrong-typed fields back to defaults', () => {
  const p = normalizeProgress({
    current_step: 'two',
    reads: ['s1'],
    stumbles: 'mud',
    seen: 'abc',
    step_history: {},
    sessions: 5,
    current_story: null,
    last_story: [],
  });
  assert.deepEqual(p, DEFAULT);
});

test('normalizeProgress rejects bad values inside otherwise valid fields', () => {
  const p = normalizeProgress({
    current_step: 0,
    reads: { a: 2, b: -1, c: 'x', d: 1.5 },
    stumbles: { mud: 3, fox: null },
    seen: ['a', 7, 'a', null, 'b'],
    step_history: [{ step: 1, promoted_at: '2026-09-14' }, { step: 'x' }, null, { step: 2 }],
    sessions: [{ date: '2026-09-15' }, 'nope', null],
    current_story: { 1: 's1-aaaa', 2: 5 },
    last_story: { 1: {} },
  });
  assert.equal(p.current_step, 1);
  assert.deepEqual(p.reads, { a: 2 });
  assert.deepEqual(p.stumbles, { mud: 3 });
  assert.deepEqual(p.seen, ['a', 'b']);
  assert.deepEqual(p.step_history, [{ step: 1, promoted_at: '2026-09-14' }]);
  assert.deepEqual(p.sessions, [{ date: '2026-09-15' }]);
  assert.deepEqual(p.current_story, { '1': 's1-aaaa' });
  assert.deepEqual(p.last_story, {});
});

test('normalizeProgress drops unknown top-level fields', () => {
  const p = normalizeProgress({ current_step: 2, evil: '<script>' });
  assert.equal('evil' in p, false);
  assert.equal(p.current_step, 2);
});

// ---- pure helpers (step 6) ----

const root = new URL('../', import.meta.url);
const banks = JSON.parse(readFileSync(new URL('data/word-banks.json', root), 'utf8'));
const scope = JSON.parse(readFileSync(new URL('data/scope-sequence.json', root), 'utf8'));
const index = buildIndex(banks);

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// Run fn on a deep-frozen copy and check the input is byte-identical after.
function pure(input, fn) {
  const frozen = deepFreeze(structuredClone(input));
  const before = JSON.stringify(frozen);
  const out = fn(frozen);
  assert.equal(JSON.stringify(frozen), before, 'input changed');
  assert.notEqual(out, frozen, 'returned the input object');
  return out;
}

test('recordSession appends a session, counts stumbles, marks seen', () => {
  const start = { ...DEFAULT, stumbles: { mud: 2 }, seen: ['s2-a'] };
  const p = pure(start, (x) =>
    recordSession(x, { story_id: 's2-b', step: 2, stumbles: ['Mud', 'fox', 'mud', ' ', 7], date: '2026-09-20' }),
  );
  assert.deepEqual(p.sessions, [{ story_id: 's2-b', step: 2, date: '2026-09-20', stumbles: ['mud', 'fox'] }]);
  assert.deepEqual(p.stumbles, { mud: 3, fox: 1 });
  assert.deepEqual(p.seen, ['s2-a', 's2-b']);
  const again = recordSession(p, { story_id: 's2-b', step: 2, stumbles: [], date: '2026-09-21' });
  assert.deepEqual(again.seen, ['s2-a', 's2-b']);
  assert.equal(again.sessions.length, 2);
  assert.deepEqual(normalizeProgress(structuredClone(again)), again, 'result survives normalize');
});

test('recordSession keeps only the last 60 sessions', () => {
  let p = defaultProgress();
  for (let i = 0; i < 65; i++) p = recordSession(p, { story_id: `s1-${i}`, step: 1, stumbles: [], date: '2026-09-20' });
  assert.equal(MAX_SESSIONS, 60);
  assert.equal(p.sessions.length, 60);
  assert.equal(p.sessions[0].story_id, 's1-5');
  assert.equal(p.sessions.at(-1).story_id, 's1-64');
  assert.equal(p.seen.length, 65);
});

test('setReads clamps to 0..3 and removes 0', () => {
  const start = { ...DEFAULT, reads: { a: 1 } };
  assert.deepEqual(pure(start, (x) => setReads(x, 'a', 2)).reads, { a: 2 });
  assert.deepEqual(pure(start, (x) => setReads(x, 'b', 9)).reads, { a: 1, b: 3 });
  assert.deepEqual(pure(start, (x) => setReads(x, 'a', -4)).reads, {});
  assert.deepEqual(pure(start, (x) => setReads(x, 'a', 'x')).reads, {});
  assert.deepEqual(pure(start, (x) => setReads(x, 'a', 2.7)).reads, { a: 2 });
});

test('setCurrentStory moves the old current story to last_story', () => {
  const p1 = pure(DEFAULT, (x) => setCurrentStory(x, 2, 's2-a'));
  assert.deepEqual(p1.current_story, { 2: 's2-a' });
  assert.deepEqual(p1.last_story, {});
  const p2 = pure(p1, (x) => setCurrentStory(x, 2, 's2-b'));
  assert.deepEqual(p2.current_story, { 2: 's2-b' });
  assert.deepEqual(p2.last_story, { 2: 's2-a' });
  assert.deepEqual(setCurrentStory(p2, 2, 's2-b').last_story, { 2: 's2-a' }, 'same story: no change');
  assert.deepEqual(setCurrentStory(p2, 3, 's3-a').last_story, { 2: 's2-a' }, 'other step untouched');
});

test('promote records the step left and sets current_step', () => {
  const p = pure({ ...DEFAULT, current_step: 1 }, (x) => promote(x, 2, '2026-09-14'));
  assert.equal(p.current_step, 2);
  assert.deepEqual(p.step_history, [{ step: 1, to: 2, promoted_at: '2026-09-14' }]);
  const back = promote(p, 1, '2026-09-15');
  assert.equal(back.current_step, 1);
  assert.deepEqual(back.step_history.at(-1), { step: 2, to: 1, promoted_at: '2026-09-15' });
  assert.deepEqual(promote(back, 1, '2026-09-16').step_history.length, 2, 'no-op to the same step');
  assert.throws(() => promote(p, 0, 'x'), RangeError);
  assert.throws(() => promote(p, '3', 'x'), RangeError);
  assert.deepEqual(normalizeProgress(structuredClone(back)), back);
});

const story = {
  id: 's3-x',
  step: 3,
  title: 'Josh and the Big Fish',
  lines: ['Josh sat on the dock.', 'Then a big fish hit his net.', 'What a shock! It was quick.', 'Josh put the fish back.'],
};

test('warmupWords: stumbles before today first, then story words from this step\'s bank', () => {
  let p = { ...DEFAULT, current_step: 3 };
  p = recordSession(p, { story_id: 's3-1', step: 3, stumbles: ['mud', 'ship'], date: '2026-09-18' });
  p = recordSession(p, { story_id: 's3-2', step: 3, stumbles: ['ship', 'cake', 'said'], date: '2026-09-19' });
  p = recordSession(p, { story_id: 's3-3', step: 3, stumbles: ['fox'], date: '2026-09-20' }); // today: ignored
  const w = pure(p, (x) => warmupWords(x, story, index, '2026-09-20'));
  // ship (2) first; then mud; cake is step 5 and said is a heart word: excluded
  assert.deepEqual(w.slice(0, 2), ['ship', 'mud']);
  assert.ok(!w.includes('fox') && !w.includes('cake') && !w.includes('said'));
  // then step-3 bank words of the story in reading order, capitalised names, deduped
  assert.deepEqual(w.slice(2), ['Josh', 'fish', 'dock', 'then', 'shock', 'quick', 'back']);
  // hearts are allowed only if passed
  const withHearts = warmupWords(p, story, index, '2026-09-20', { hearts: heartWords(3, scope) });
  assert.deepEqual(withHearts.slice(0, 3), ['ship', 'said', 'mud']); // tie on 1: said is more recent
});

test('warmupWords caps at 6 stumble words and 14 in all', () => {
  let p = { ...DEFAULT, current_step: 4 };
  const words = ['mud', 'fox', 'ship', 'cat', 'dog', 'sun', 'hen', 'pig'];
  // make the counts distinct: mud 8, fox 7, ...
  words.forEach((w, i) => {
    for (let k = 0; k < words.length - i; k++) {
      p = recordSession(p, { story_id: `s4-${w}${k}`, step: 4, stumbles: [w], date: '2026-09-01' });
    }
  });
  const long = {
    title: 'Frogs',
    lines: ['frogs jump and swim and grab bugs', 'crabs, clams, and ducks swim fast', 'a stump, a plank, a raft, a nest', 'drums and flags and gifts and tents'],
  };
  const w = warmupWords(p, long, index, '2026-09-02');
  assert.deepEqual(w.slice(0, 6), ['mud', 'fox', 'ship', 'cat', 'dog', 'sun']);
  assert.equal(w.length, 14);
  assert.equal(new Set(w).size, 14);
});

test('warmupWords tolerates missing pieces', () => {
  assert.deepEqual(warmupWords(DEFAULT, null, index, '2026-09-20'), []);
  assert.deepEqual(warmupWords(undefined, story, undefined, undefined), []);
});

test('readiness summarises a step for the hint', () => {
  let p = { ...DEFAULT, current_step: 2 };
  assert.deepEqual(readiness(p, 2), {
    stories_read: 0, avg_reads: 0, first_session_stumbles: null, last_session_stumbles: null, sessions: 0,
  });
  p = recordSession(p, { story_id: 's1-a', step: 1, stumbles: ['a', 'b'], date: '2026-09-10' });
  p = recordSession(p, { story_id: 's2-a', step: 2, stumbles: ['x', 'y', 'z'], date: '2026-09-11' });
  p = recordSession(p, { story_id: 's2-b', step: 2, stumbles: ['x'], date: '2026-09-12' });
  p = recordSession(p, { story_id: 's2-b', step: 2, stumbles: [], date: '2026-09-13' });
  p = setReads(setReads(setReads(p, 's2-a', 3), 's2-b', 2), 's1-a', 3);
  const r = pure(p, (x) => readiness(x, 2));
  assert.deepEqual(r, { stories_read: 2, avg_reads: 2.5, first_session_stumbles: 3, last_session_stumbles: 0, sessions: 3 });
});
