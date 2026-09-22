import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildIndex, allowedWords, bankWords, heartWords, entryFor, permittedGraphemes,
} from '../lib/bank.js';
import { checkBank } from '../scripts/check-bank.js';

const banks = JSON.parse(readFileSync(new URL('../data/word-banks.json', import.meta.url), 'utf8'));
const scope = JSON.parse(readFileSync(new URL('../data/scope-sequence.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const words = (line) => line.split(/\s+/).map((t) => t.replace(/[^A-Za-z]/g, '').toLowerCase()).filter(Boolean);

// The five stories of docs/prototype.html, by step.
const PROTOTYPE = {
  1: ['Sam has a cat.', 'The cat is fat.', 'The cat sat.', 'Sam has a bat.', 'The cat ran at the bat.',
    'Sam ran. The cat ran.', 'The cat has the bat!', 'Sam is sad.'],
  2: ['The big pig sat in the mud.', 'A red fox ran up to him.', 'The fox had a hot bun.', 'The pig got up.',
    'The fox cut the bun.', 'The fox and the pig had fun in the sun.'],
  3: ['Jack has a red ship.', 'He set it in a big tub.', 'A fat fish is in that tub.', 'The fish hit the ship.',
    'Then the ship got a chip in it.', 'Jack was sad.', 'He set the ship on a rock.', 'The fish has the tub!'],
  4: ['A crab sits on the wet sand.', 'The crab digs and digs.', 'A big frog jumps in.', 'The frog grabs a clam.',
    'Stop! Drop that clam!', 'The frog drops the clam in the sand.', 'The crab grabs it and runs.', 'The frog is not glad.'],
  5: ['Jake has a red bike.', 'He can ride it to the lake.', 'At the lake, Jake met a snake.', 'The snake is on a rock.',
    'Jake did not like that.', 'He rode home fast.', 'Jake is safe at home.'],
};

// Prototype warm-up words, by step.
const WARMUP = {
  1: 'sat cat fat bat mat rat ran man bag tag sad had ham jam',
  2: 'pig dig hot pot dog sun run bug hug red bed leg sit hit cup cut mud fox',
  3: 'ship shop shut fish dish chin chip chop much this that then with back duck rock sock kick',
  4: 'stop step spin slip clap flag grab drum trip crab frog plan snap hand jump fast best milk',
  5: 'make cake lake ride bike like time nine home note rope safe cute mane pine hope',
};

test('the real banks pass check-bank', () => {
  assert.deepEqual(checkBank(banks, scope), []);
});

test('scope sequence has steps 1-10 in the spec shape, without word_bank', () => {
  assert.equal(scope.length, 10);
  scope.forEach((s, i) => {
    assert.equal(s.id, i + 1);
    for (const k of ['tag', 'name', 'teaches', 'graphemes_added', 'structures_added', 'heart_words']) {
      assert.ok(k in s, `step ${s.id} missing ${k}`);
    }
    assert.ok(!('word_bank' in s), `step ${s.id} duplicates word_bank`);
  });
});

test('bank sizes: steps 1-5 substantial, steps 6-10 at least 25', () => {
  assert.ok(banks['1'].length >= 50, `step 1 has ${banks['1'].length}`);
  for (const s of ['2', '3', '4', '5']) assert.ok(banks[s].length >= 60, `step ${s} has ${banks[s].length}`);
  for (const s of ['6', '7', '8', '9', '10']) assert.ok(banks[s].length >= 25, `step ${s} has ${banks[s].length}`);
});

test('every prototype story word is allowed at its step', () => {
  for (const [step, lines] of Object.entries(PROTOTYPE)) {
    const ok = allowedWords(Number(step), banks, scope);
    for (const line of lines) for (const w of words(line)) assert.ok(ok.has(w), `step ${step}: "${w}" not allowed`);
  }
});

test('every prototype warm-up word is a bank word at or before its step', () => {
  for (const [step, list] of Object.entries(WARMUP)) {
    const ok = bankWords(Number(step), banks);
    for (const w of list.split(' ')) assert.ok(ok.has(w), `step ${step}: "${w}" not in banks`);
  }
});

test('function words are available from the step they decode', () => {
  const at = { 1: 'at am an can had ran sat', 2: 'in on it up us if not got did get let yes but him yet', 3: 'this that then them with when which will off', 4: 'just went its', 5: 'like made came gave' };
  for (const [step, list] of Object.entries(at)) {
    const idx = buildIndex(banks);
    for (const w of list.split(' ')) assert.equal(entryFor(w, idx)?.step, Number(step), `"${w}"`);
  }
});

test('heart words are cumulative; is/has/his/as are hearts at step 1', () => {
  const h1 = heartWords(1, scope);
  for (const w of ['the', 'a', 'is', 'has', 'his', 'as']) assert.ok(h1.has(w), w);
  assert.ok(!h1.has('was'));
  const h3 = heartWords(3, scope);
  for (const w of h1) assert.ok(h3.has(w), `step 3 lost ${w}`);
  assert.ok(h3.has('was') && h3.has('he'));
  assert.ok(!heartWords(2, scope).has('he'));
});

test('allowedWords is banks 1..step plus hearts 1..step, nothing later', () => {
  const a2 = allowedWords(2, banks, scope);
  for (const w of ['fox', 'cat', 'and', 'to', 'the']) assert.ok(a2.has(w), w);
  for (const w of ['ship', 'was', 'stop', 'bike', 'through', 'rain']) assert.ok(!a2.has(w), w);
  assert.ok(allowedWords(3, banks, scope).has('ship'));
});

test('entryFor is case-insensitive and returns null for unknown words', () => {
  const idx = buildIndex(banks);
  const jack = entryFor('Jack', idx);
  assert.equal(jack.step, 3);
  assert.equal(jack.name, true);
  assert.deepEqual(jack.g, [['j', 'c'], ['a', 'v'], ['ck', 'd']]);
  assert.deepEqual(entryFor('ship', idx).g, [['sh', 'd'], ['i', 'v'], ['p', 'c']]);
  assert.deepEqual(entryFor('make', idx).g, [['m', 'c'], ['a', 'v'], ['k', 'c'], ['e', 's']]);
  assert.equal(entryFor('through', idx), null);
  assert.equal(entryFor(undefined, idx), null);
});

test('irregular and exception words are in no bank', () => {
  const all = bankWords(10, banks);
  const never = ('kind find mind wild child wind cold old gold hold told bold roll toll poll most post host both ' +
    'was wasp want wash wand swan swap watch squash put push pull full bull bush all ball call tall fall small walk talk ' +
    'son ton won from front of to do go no so into have give live come some one done gone none love move dove glove ' +
    'lose whose whole were there where here these what said they are you he she we me be my by egg add odd inn ' +
    'ice nice rice face page cage age huge use close read row bow great bear pear ear word work worm war warm house mouse ' +
    'through light beautiful');
  for (const w of never.split(' ')) assert.ok(!all.has(w), `"${w}" should not be a bank word`);
});

test('final -s after a voiced sound is marked s:z; no s:z before step 4', () => {
  const VOICED = new Set(['b', 'd', 'g', 'l', 'll', 'm', 'n', 'ng', 'r', 'v', 'w', 'z']);
  for (const [step, entries] of Object.entries(banks)) {
    for (const e of entries) {
      if (Number(step) > 5) continue;
      const last = e.g.at(-1);
      if (last[0] !== 's' || e.g.length < 3) continue;
      let prev = e.g.at(-2);
      if (prev[1] === 's') prev = e.g.at(-3);
      const z = e.sounds?.at(-1) === 's:z';
      if (VOICED.has(prev[0])) {
        assert.ok(Number(step) >= 4, `${e.w}: -s after voiced "${prev[0]}" at step ${step}`);
        assert.ok(z, `${e.w}: -s after voiced "${prev[0]}" lacks s:z`);
      } else {
        assert.ok(!z, `${e.w}: s:z after unvoiced "${prev[0]}"`);
      }
    }
  }
});

test('regular -s forms of step 1-5 nouns and verbs are bank words at the right step (bank-inflections)', () => {
  const idx = buildIndex(banks);
  // word: [step, says /z/]
  const expect = {
    // the words the step-5 story writer missed
    pups: [4, false], lids: [4, true], plums: [4, true], twigs: [4, true], cuts: [4, false],
    lifts: [4, false], bites: [5, false], plates: [5, false], grapes: [5, false], dimes: [5, true],
    // a sample of the rest: step 4 and 5, /s/ and /z/
    mats: [4, false], lots: [4, false], thanks: [4, false], chicks: [4, false], huffs: [4, false],
    spots: [4, false], pants: [4, false], vans: [4, true], jugs: [4, true], shells: [4, true],
    songs: [4, true], swims: [4, true], grins: [4, true], bathtubs: [4, true],
    takes: [5, false], hikes: [5, false], saves: [5, true], tunes: [5, true], stones: [5, true], whales: [5, true],
  };
  for (const [w, [step, z]] of Object.entries(expect)) {
    const e = entryFor(w, idx);
    assert.ok(e, `${w} is not a bank word`);
    assert.equal(e.step, step, `${w} step`);
    assert.deepEqual(e.g.at(-1), ['s', 'c'], `${w} ends in s (c)`);
    const stem = entryFor(w.slice(0, -1), idx);
    assert.ok(stem && stem.step <= step, `${w}: stem not in the bank at or before step ${step}`);
    assert.deepEqual(e.g.slice(0, -1), stem.g, `${w}: g is the stem's g + s`);
    assert.equal(e.sounds?.at(-1) === 's:z', z, `${w} s:z marking`);
    if (!z) assert.equal(e.sounds, undefined, `${w} has no sounds`);
  }
  // left out on purpose: adjectives, function words, irregular plurals, heart stems
  const all = bankWords(10, banks);
  for (const w of ['bigs', 'reds', 'nots', 'ups', 'muds', 'mens', 'mans', 'puts', 'comes', 'gives', 'paths']) {
    assert.ok(!all.has(w), `"${w}" should not be a bank word`);
  }
});

test('permitted graphemes: steps 1-2 are single letters, y never a vowel', () => {
  const p2 = permittedGraphemes(2, scope);
  for (const k of p2) assert.match(k, /^[a-z]:[cv]$/);
  assert.ok(!p2.has('q:c'));
  assert.ok(!permittedGraphemes(10, scope).has('y:v'));
  assert.ok(permittedGraphemes(3, scope).has('ll:d'));
  assert.ok(!permittedGraphemes(4, scope).has('e:s'));
  assert.ok(permittedGraphemes(5, scope).has('e:s'));
});

// ---- the checker catches what it should ----

function withEntry(step, entry) {
  const b = clone(banks);
  b[String(step)].push({ step, ...entry });
  return b;
}
const errorsFor = (b, s = scope) => checkBank(b, s).join('\n');

test('check-bank rejects an untaught grapheme (ship at step 2, through anywhere early)', () => {
  assert.match(errorsFor(withEntry(2, { w: 'shim', g: [['sh', 'd'], ['i', 'v'], ['m', 'c']] })), /"sh" \(d\) is not taught by step 2/);
  assert.match(errorsFor(withEntry(2, { w: 'through', g: [['th', 'd'], ['r', 'c'], ['ough', 't']] })), /through/);
  assert.match(errorsFor(withEntry(1, { w: 'fit', g: [['f', 'c'], ['i', 'v'], ['t', 'c']] })), /"i" \(v\) is not taught by step 1/);
});

test('check-bank rejects clusters before step 4 and silent e before step 5', () => {
  assert.match(errorsFor(withEntry(3, { w: 'clip', g: [['c', 'c'], ['l', 'c'], ['i', 'v'], ['p', 'c']] })), /cluster "cl"/);
  assert.match(errorsFor(withEntry(4, { w: 'kite', g: [['k', 'c'], ['i', 'v'], ['t', 'c'], ['e', 's']] })), /"e" \(s\) is not taught by step 4/);
  assert.match(errorsFor(withEntry(2, { w: 'sunup', g: [['s', 'c'], ['u', 'v'], ['n', 'c'], ['u', 'v'], ['p', 'c']] })), /2 vowel graphemes/);
});

test('check-bank rejects join mismatch, bad kind, duplicates and heart overlap', () => {
  assert.match(errorsFor(withEntry(2, { w: 'pod', g: [['p', 'c'], ['o', 'v']] })), /also in bank 2/);
  assert.match(errorsFor(withEntry(2, { w: 'nod', g: [['n', 'c'], ['o', 'v'], ['t', 'c']] })), /join to "not"/);
  assert.match(errorsFor(withEntry(2, { w: 'zot', g: [['z', 'x'], ['o', 'v'], ['t', 'c']] })), /bad kind "x"/);
  assert.match(errorsFor(withEntry(4, { w: 'and', g: [['a', 'v'], ['n', 'c'], ['d', 'c']] })), /heart word/);
  assert.match(errorsFor(withEntry(4, { w: 'digs', g: [['d', 'c'], ['i', 'v'], ['g', 'c'], ['s', 'c']] })), /also in bank 4/);
});

test('check-bank enforces sounds for ambiguous graphemes and sound steps', () => {
  assert.match(errorsFor(withEntry(6, { w: 'meal', g: [['m', 'c'], ['ea', 't'], ['l', 'c']] })), /ambiguous grapheme but no sounds/);
  assert.match(errorsFor(withEntry(6, { w: 'meal', g: [['m', 'c'], ['ea', 't'], ['l', 'c']], sounds: ['m', 'ea'] })), /one item per grapheme/);
  assert.match(errorsFor(withEntry(2, { w: 'bes', g: [['b', 'c'], ['e', 'v'], ['s', 'c']], sounds: ['b', 'e', 's:z'] })), /s as \/z\/ is not taught before step 4/);
  assert.match(errorsFor(withEntry(7, { w: 'vow', g: [['v', 'c'], ['ow', 't']], sounds: ['v', 'ow:ou'] })), /not taught before step 9/);
});

test('check-bank rejects a multi-letter grapheme at steps 1-2 and unknown graphemes', () => {
  const s = clone(scope);
  s[1].graphemes_added.push('sh');
  assert.match(errorsFor(banks, s), /"sh" is not a single letter/);
  const s2 = clone(scope);
  s2[5].graphemes_added.push('igh');
  assert.match(errorsFor(banks, s2), /unknown grapheme in scope sequence: igh/);
});
