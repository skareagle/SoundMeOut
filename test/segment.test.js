import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, heartWords } from '../lib/bank.js';
import { segment, fallbackGraphemes, isHeartWord, splitToken, SOUND_LABEL } from '../lib/segment.js';

const root = new URL('../', import.meta.url);
const banks = JSON.parse(readFileSync(new URL('data/word-banks.json', root), 'utf8'));
const scope = JSON.parse(readFileSync(new URL('data/scope-sequence.json', root), 'utf8'));
const index = buildIndex(banks);
const pools = [1, 2, 3, 4, 5].map((n) => JSON.parse(readFileSync(new URL(`stories/step-${n}.json`, root), 'utf8')));

const tk = (gs) => gs.map((g) => [g.t, g.k]);
const MAC = '̄';

test('every bank entry in steps 1–5 segments to its own g (text and kind)', () => {
  let n = 0;
  for (const s of ['1', '2', '3', '4', '5']) {
    for (const e of banks[s]) {
      assert.deepEqual(tk(segment(e.w, index)), e.g, e.w);
      n++;
    }
  }
  assert.ok(n > 700, `checked ${n}`);
});

test('every bank entry in steps 6–10 also segments to its own g', () => {
  for (const s of ['6', '7', '8', '9', '10']) {
    for (const e of banks[s]) assert.deepEqual(tk(segment(e.w, index)), e.g, e.w);
  }
});

test('ship, make, Jack', () => {
  assert.deepEqual(segment('ship', index), [
    { t: 'sh', k: 'd', sound: '/sh/' },
    { t: 'i', k: 'v', sound: '/i/' },
    { t: 'p', k: 'c', sound: '/p/' },
  ]);
  assert.deepEqual(segment('make', index), [
    { t: 'm', k: 'c', sound: '/m/' },
    { t: 'a', k: 'v', sound: '/a' + MAC + '/' },
    { t: 'k', k: 'c', sound: '/k/' },
    { t: 'e', k: 's', sound: null },
  ]);
  assert.deepEqual(segment('Jack', index), [
    { t: 'J', k: 'c', sound: '/j/' },
    { t: 'a', k: 'v', sound: '/a/' },
    { t: 'ck', k: 'd', sound: '/ck/' },
  ]);
});

test('casing is preserved letter for letter', () => {
  assert.deepEqual(segment('SHIP', index).map((g) => g.t), ['SH', 'I', 'P']);
  assert.deepEqual(segment('Then', index).map((g) => g.t), ['Th', 'e', 'n']);
  assert.deepEqual(segment('sHiP', index).map((g) => g.t), ['sH', 'i', 'P']);
});

test('bank sounds override the display sound', () => {
  const digs = segment('digs', index);
  assert.equal(digs.at(-1).sound, '/z/');
  assert.equal(segment('cats', index).at(-1).sound, '/s/');
  // magic e with a final s:z: long vowel, silent e, /z/
  assert.deepEqual(segment('rides', index).map((g) => g.sound), ['/r/', '/i' + MAC + '/', '/d/', null, '/z/']);
  // s:z inside a magic-e word
  assert.deepEqual(segment('nose', index).map((g) => g.sound), ['/n/', '/o' + MAC + '/', '/z/', null]);
  assert.deepEqual(segment('bread', index).map((g) => g.sound), ['/b/', '/r/', '/e/', '/d/']);
  assert.equal(segment('moon', index)[1].sound, '/oo/');
  assert.equal(segment('ate', index)[0].sound, '/a' + MAC + '/');
});

test('every step 6–10 `sounds` tag has a label', () => {
  for (const es of Object.values(banks)) {
    for (const e of es) {
      for (const s of e.sounds || []) {
        if (s.includes(':')) assert.ok(Object.hasOwn(SOUND_LABEL, s.split(':')[1]), `${e.w}: ${s}`);
      }
    }
  }
});

test('every magic-e bank word gives its vowel a long sound and the e no sound', () => {
  for (const es of Object.values(banks)) {
    for (const e of es) {
      const i = e.g.findIndex(([, k]) => k === 's');
      if (i < 0) continue;
      const gs = segment(e.w, index);
      assert.equal(gs[i].sound, null, e.w);
      const v = gs.findLastIndex((g, j) => j < i && g.k === 'v');
      assert.match(gs[v].sound, new RegExp(`^/[aeiou]${MAC}/$`), e.w);
    }
  }
});

test('unknown words fall back to the Appendix A splitter', () => {
  assert.equal(index.has('zib'), false);
  assert.deepEqual(segment('Zib', index), [
    { t: 'Z', k: 'c', sound: '/z/' },
    { t: 'i', k: 'v', sound: '/i/' },
    { t: 'b', k: 'c', sound: '/b/' },
  ]);
  assert.deepEqual(tk(segment('phone', index)), [['ph', 'd'], ['o', 'v'], ['n', 'c'], ['e', 's']]);
  assert.deepEqual(tk(segment('shrill', index)), [['sh', 'd'], ['r', 'c'], ['i', 'v'], ['ll', 'd']]);
  // no index at all
  assert.deepEqual(tk(segment('ship')), [['sh', 'd'], ['i', 'v'], ['p', 'c']]);
  assert.deepEqual(segment('', index), []);
  assert.deepEqual(segment(undefined, index), []);
});

test('the fallback agrees with the bank for steps 1–5 except magic-e + s and 3-letter magic e', () => {
  const differ = [];
  for (const s of ['1', '2', '3', '4', '5']) {
    for (const e of banks[s]) {
      if (JSON.stringify(tk(fallbackGraphemes(e.w))) !== JSON.stringify(e.g)) differ.push(e);
    }
  }
  // Appendix A only finds a word-final silent e in words of 4+ letters.
  for (const e of differ) {
    const i = e.g.findIndex(([, k]) => k === 's');
    assert.ok(i >= 0 && (i !== e.g.length - 1 || e.w.length < 4), `unexpected fallback difference: ${e.w}`);
  }
  // ...and every magic-e + s word does differ (the fallback misses the e before
  // a final s), including the -s forms added by plans/bank-inflections.md.
  const differs = new Set(differ.map((e) => e.w));
  const magicS = ['1', '2', '3', '4', '5'].flatMap((s) => banks[s])
    .filter((e) => e.g.length > 1 && e.g.at(-2)[1] === 's' && e.g.at(-1)[0] === 's');
  assert.ok(magicS.length >= 72, `only ${magicS.length} magic-e + s words`);
  for (const e of magicS) assert.ok(differs.has(e.w), `fallback now agrees on ${e.w}`);
  for (const w of ['rides', 'bikes', 'bites', 'plates', 'grapes', 'dimes', 'tunes', 'saves']) assert.ok(differs.has(w), w);
});

test('every word in the five story pools segments, joins back exactly, or is a heart word', () => {
  const hearts = heartWords(5, scope);
  let words = 0;
  let heart = 0;
  for (const pool of pools) {
    const stepHearts = heartWords(pool.step, scope);
    const seen = new Set();
    for (const story of pool.stories) {
      for (const text of [story.title, ...story.lines]) {
        for (const tok of text.split(/\s+/)) {
          const { pre, word, post } = splitToken(tok);
          assert.equal(pre + word + post, tok);
          if (!word || seen.has(word)) continue;
          seen.add(word);
          words++;
          if (isHeartWord(word, stepHearts)) {
            heart++;
            assert.equal(index.has(word.toLowerCase()), false, `${word} is both heart and bank`);
            continue;
          }
          assert.ok(index.has(word.toLowerCase()), `${word} (step ${pool.step}) is neither heart nor bank`);
          assert.ok(!hearts.has(word.toLowerCase()));
          const gs = segment(word, index);
          assert.equal(gs.map((g) => g.t).join(''), word, word);
          for (const g of gs) {
            assert.ok(['c', 'v', 'd', 's', 't'].includes(g.k), word);
            assert.ok(g.k === 's' ? g.sound === null : /^\/.+\/$/.test(g.sound), `${word}: ${g.sound}`);
          }
        }
      }
    }
  }
  assert.ok(words > 1000, `checked ${words} words`);
  assert.ok(heart > 0);
});

test('isHeartWord is case-insensitive and needs a set', () => {
  const h = heartWords(3, scope);
  assert.equal(isHeartWord('Said', h), true);
  assert.equal(isHeartWord('ship', h), false);
  assert.equal(isHeartWord('said', undefined), false);
  assert.equal(isHeartWord('said', heartWords(2, scope)), false);
});

test('splitToken keeps punctuation outside the word', () => {
  assert.deepEqual(splitToken('"Stop!"'), { pre: '"', word: 'Stop', post: '!"' });
  assert.deepEqual(splitToken('cat,'), { pre: '', word: 'cat', post: ',' });
  assert.deepEqual(splitToken("can't."), { pre: '', word: "can't", post: '.' });
  assert.deepEqual(splitToken('—'), { pre: '—', word: '', post: '' });
});
