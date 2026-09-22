import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateStory, tokenize, normalizeToken, formatError } from '../lib/validate.js';
import { validatePools } from '../scripts/validate.js';

const banks = JSON.parse(readFileSync(new URL('../data/word-banks.json', import.meta.url), 'utf8'));
const scope = JSON.parse(readFileSync(new URL('../data/scope-sequence.json', import.meta.url), 'utf8'));

const ctx = (step) => ({ step, banks, scope });
const clone = (x) => JSON.parse(JSON.stringify(x));
const codes = (r) => r.errors.map((e) => e.code);

// A valid step-2 story: the baseline every mutation starts from. (The
// prototype's own step-2 story fails R3 — see the plan's Found along the way.)
const STEP2 = {
  id: 's2-0001',
  step: 2,
  title: 'The pig and the fox',
  lines: [
    'Ben the pig sat in hot mud.',
    'A red fox ran up to him.',
    'Bob had a big bun.',
    'His pet pig got up.',
    'It dug a wet pit.',
    'Fun! The fox and Ben had a nap.',
  ],
  words_used: [],
  validated_at: '2026-09-20T00:00:00Z',
  generator: 'test',
};

test('a valid step-2 story passes at step 2', () => {
  const r = validateStory(STEP2, ctx(2));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.ok(r.words.includes('pig'));
  assert.equal(new Set(r.words).size, r.words.length, 'words are distinct');
});

test('poisoned story: "through" in a step-2 story is rejected and named', () => {
  const s = clone(STEP2);
  s.lines[1] = 'A red fox ran through the mud.';
  const r = validateStory(s, ctx(2));
  assert.equal(r.ok, false);
  const bad = r.errors.filter((e) => e.code === 'word');
  assert.deepEqual(bad, [{ code: 'word', word: 'through', line: 1 }]);
  assert.match(formatError(bad[0]), /"through"/);
});

test('a word legal at step 3 is rejected in a step-2 story', () => {
  const s = clone(STEP2);
  s.lines[2] = 'Bob had a ship.';
  const r = validateStory(s, ctx(2));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.filter((e) => e.code === 'word'), [{ code: 'word', word: 'ship', line: 2 }]);
  // ... and the same story passes at step 3.
  assert.equal(validateStory({ ...s, step: 3 }, ctx(3)).ok, true);
});

test('a name that is not in the bank is rejected', () => {
  const s = clone(STEP2);
  s.lines[3] = 'His pet Milo got up.';
  const r = validateStory(s, ctx(2));
  assert.deepEqual(r.errors.filter((e) => e.code === 'word'), [{ code: 'word', word: 'milo', line: 3 }]);
  // A bank name at this step is fine.
  s.lines[3] = 'His pet cub got up.';
  assert.equal(validateStory(s, ctx(2)).ok, true);
});

test('the title is validated too', () => {
  const s = clone(STEP2);
  s.title = 'The fox and the ship';
  const r = validateStory(s, ctx(2));
  assert.deepEqual(r.errors, [{ code: 'word', word: 'ship', line: 'title' }]);
  assert.equal(formatError(r.errors[0]), 'word not allowed: "ship" (title)');
});

test('heart words are allowed', () => {
  const s = clone(STEP2);
  s.lines[3] = 'I said his pet got up.'; // "i" and "said" are heart words at step 3
  assert.deepEqual(validateStory({ ...s, step: 3 }, ctx(3)).errors, []);
  assert.deepEqual(
    validateStory(s, ctx(2)).errors.filter((e) => e.code === 'word'),
    [{ code: 'word', word: 'said', line: 3 }],
  );
});

test('punctuation is stripped and case ignored', () => {
  const s = clone(STEP2);
  s.lines[3] = '"Sit, pig!" — said Bob.';
  const r = validateStory({ ...s, step: 3 }, ctx(3));
  assert.deepEqual(r.errors, []);
  const s2 = clone(STEP2);
  s2.lines[3] = 'HIS PET PIG GOT UP!';
  assert.deepEqual(validateStory(s2, ctx(2)).errors, []);
});

test('tokenize and normalizeToken', () => {
  assert.deepEqual(tokenize('"Stop!" said the fox,'), ['stop', 'said', 'the', 'fox']);
  assert.deepEqual(tokenize('  '), []);
  assert.equal(normalizeToken('cat,'), 'cat');
  assert.equal(normalizeToken('—'), '');
  assert.equal(normalizeToken('...'), '');
  assert.equal(normalizeToken("'cat'"), 'cat');
  assert.equal(normalizeToken('Don’t'), "don't"); // curly apostrophe kept as '
  assert.equal(normalizeToken("don't"), "don't");
  assert.equal(normalizeToken('sun-hat'), null);
  assert.equal(normalizeToken('3'), null);
  assert.equal(normalizeToken('b3d'), null);
});

test('a word with an apostrophe is rejected unless it is in the lists', () => {
  const s = clone(STEP2);
  s.lines[3] = "His pet pig can't get up.";
  const r = validateStory(s, ctx(2));
  assert.deepEqual(r.errors.filter((e) => e.code === 'word'), [{ code: 'word', word: "can't", line: 3 }]);
});

test('a token that is not a word at all is reported', () => {
  const s = clone(STEP2);
  s.lines[3] = 'His pet pig got 2 buns.';
  const r = validateStory(s, ctx(2));
  assert.deepEqual(r.errors.filter((e) => e.code === 'bad_token'), [{ code: 'bad_token', token: '2', line: 3 }]);
});

test('R3: fewer than 5 lines', () => {
  const s = clone(STEP2);
  s.lines = s.lines.slice(0, 4);
  const r = validateStory(s, ctx(2));
  assert.ok(r.errors.some((e) => e.code === 'too_few_lines' && e.count === 4 && e.min === 5));
  assert.equal(validateStory({ ...clone(STEP2), lines: clone(STEP2).lines.slice(0, 5) }, ctx(2)).ok, true);
});

test('R3: a line over 9 words', () => {
  const s = clone(STEP2);
  s.lines[3] = 'The big red fox and the fat pig ran up.'; // 10 words
  const r = validateStory(s, ctx(2));
  assert.ok(r.errors.some((e) => e.code === 'line_too_long' && e.line === 3 && e.count === 10 && e.max === 9));
  s.lines[3] = 'The big red fox and the fat pig ran.'; // 9 words
  assert.deepEqual(validateStory(s, ctx(2)).errors, []);
});

test('R3: duplicate lines (ignoring case and punctuation)', () => {
  const s = clone(STEP2);
  s.lines[4] = 'Ben the Pig sat in Hot mud!';
  const r = validateStory(s, ctx(2));
  assert.ok(r.errors.some((e) => e.code === 'duplicate_line' && e.line === 4 && e.first === 0));
});

test('R3: distinct words under 60% of total', () => {
  const s = clone(STEP2);
  s.lines = [
    'The pig sat in the mud.',
    'The pig sat in the sun.',
    'The pig sat in the bus.',
    'The pig sat in the tub.',
    'The pig ran in the mud.',
    'The pig ran in the sun.',
  ];
  const r = validateStory(s, ctx(2));
  const e = r.errors.find((x) => x.code === 'low_variety');
  assert.ok(e, `expected low_variety, got ${JSON.stringify(r.errors)}`);
  assert.ok(e.distinct < 0.6 * e.total);
});

test('shape errors: step mismatch, bad title, bad lines, empty line, non-string line', () => {
  assert.ok(validateStory({ ...clone(STEP2), step: 3 }, ctx(2)).errors
    .some((e) => e.code === 'step_mismatch' && e.expected === 2 && e.got === 3));
  assert.ok(validateStory({ ...clone(STEP2), title: '  ' }, ctx(2)).errors.some((e) => e.code === 'bad_title'));
  assert.ok(validateStory({ ...clone(STEP2), lines: [] }, ctx(2)).errors.some((e) => e.code === 'bad_lines'));
  assert.ok(validateStory({ ...clone(STEP2), lines: 'a story' }, ctx(2)).errors.some((e) => e.code === 'bad_lines'));
  assert.deepEqual(codes(validateStory(null, ctx(2))), ['not_object']);
  assert.deepEqual(codes(validateStory([], ctx(2))), ['not_object']);
  const s = clone(STEP2);
  s.lines[1] = '...';
  assert.ok(validateStory(s, ctx(2)).errors.some((e) => e.code === 'empty_line' && e.line === 1));
  const s2 = clone(STEP2);
  s2.lines[1] = 42;
  assert.ok(validateStory(s2, ctx(2)).errors.some((e) => e.code === 'bad_line' && e.line === 1));
});

test('every error is reported, not just the first', () => {
  const s = clone(STEP2);
  s.lines = ['A fox ran through the mud.', 'A fox ran through the mud.', 'Jack got up.'];
  const r = validateStory(s, ctx(2));
  const cs = codes(r);
  assert.ok(cs.filter((c) => c === 'word').length >= 3, JSON.stringify(r.errors));
  assert.ok(cs.includes('duplicate_line'));
  assert.ok(cs.includes('too_few_lines'));
});

test('a precomputed allowed set gives the same answer', () => {
  const allowed = new Set(['the', 'pig', 'sat']);
  const r = validateStory(STEP2, { step: 2, allowed });
  assert.ok(r.errors.some((e) => e.code === 'word' && e.word === 'fox'));
});

// --- scripts/validate.js ---

function poolRoot(pools) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-test-'));
  mkdirSync(path.join(root, 'stories'));
  for (const [step, pool] of Object.entries(pools)) {
    writeFileSync(path.join(root, 'stories', `step-${step}.json`), JSON.stringify(pool));
  }
  return root;
}

test('validatePools: a clean pool and a poisoned one', () => {
  const poisoned = clone(STEP2);
  poisoned.id = 's2-0002';
  poisoned.title = 'The fox runs';
  poisoned.lines[1] = 'A red fox ran through the mud.';
  const root = poolRoot({ 2: { step: 2, stories: [clone(STEP2), poisoned] } });
  const { pools, skipped } = validatePools({ root, banks, scope });
  assert.deepEqual(skipped, []);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].total, 2);
  assert.equal(pools[0].failures.length, 1);
  assert.equal(pools[0].failures[0].id, 's2-0002');
  assert.ok(pools[0].failures[0].errors.some((e) => e.word === 'through'));
});

test('validatePools: missing pools are skipped, a mislabelled pool is a problem', () => {
  const root = poolRoot({ 2: { step: 3, stories: [] } });
  const r = validatePools({ root, steps: [1, 2], banks, scope });
  assert.deepEqual(r.skipped, [1]);
  assert.equal(r.pools.length, 1);
  assert.match(r.pools[0].problem, /pool step is 3/);
  const empty = validatePools({ root: mkdtempSync(path.join(tmpdir(), 'validate-test-')), banks, scope });
  assert.deepEqual(empty, { pools: [], skipped: [] });
});
