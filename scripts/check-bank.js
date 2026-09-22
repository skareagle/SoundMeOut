// npm run check-bank — verifies data/word-banks.json against
// data/scope-sequence.json. Exits non-zero with a list on failure.
//
// Checks, per entry:
//   - w is lowercase a-z; entry.step matches the bank it sits in
//   - g is a non-empty list of [text, kind]; kinds are c v d s t; texts join to w
//   - every grapheme (text + kind) is permitted at or before the entry's step,
//     derived from graphemes_added (steps 1-2 add single letters only)
//   - steps 1-3 are CVC-shaped: exactly one vowel grapheme and no two
//     consonant graphemes (c or d) side by side — clusters start at step 4
//   - sounds, if present, has one item per grapheme, each "text" or
//     "text:sound" with text equal to that grapheme; it is required when a
//     grapheme is ambiguous (ea ow oo ou ed es); "s:z" appears only from step 4;
//     "ow:ou" (cow) only from the step that adds "ou" (ow is taught as long o first)
//   - name, if present, is true
// Across the banks: no word appears twice (at one step or two), and no bank
// word is also a heart word at any step (a word is one or the other).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { KINDS, AMBIGUOUS, graphemeKeys, permittedGraphemes, heartWords } from '../lib/bank.js';

const CONSONANT_KINDS = new Set(['c', 'd']);

export function checkBank(banks, scope) {
  const errors = [];
  const err = (w, step, msg) => errors.push(`step ${step} ${JSON.stringify(w)}: ${msg}`);

  if (!Array.isArray(scope) || scope.length === 0) return ['scope sequence is empty or not an array'];
  scope.forEach((s, i) => {
    if (s.id !== i + 1) errors.push(`scope: entry ${i} has id ${s.id}, expected ${i + 1}`);
    for (const item of s.graphemes_added || []) {
      try { graphemeKeys(item); } catch (e) { errors.push(`scope step ${s.id}: ${e.message}`); }
      if (s.id <= 2 && !/^[a-z]$/.test(item)) errors.push(`scope step ${s.id}: "${item}" is not a single letter`);
    }
    for (const h of s.heart_words || []) {
      if (h !== h.toLowerCase()) errors.push(`scope step ${s.id}: heart word "${h}" is not lowercase`);
    }
  });
  if (errors.length) return errors;

  const maxStep = scope.length;
  const allHearts = heartWords(maxStep, scope);
  const permitted = {};
  for (let s = 1; s <= maxStep; s++) permitted[s] = permittedGraphemes(s, scope);

  const ouStep = (scope.find((s) => (s.graphemes_added || []).includes('ou')) || { id: Infinity }).id;
  const where = new Map();
  for (const [key, entries] of Object.entries(banks)) {
    const step = Number(key);
    if (!Number.isInteger(step) || step < 1 || step > maxStep) {
      errors.push(`bank "${key}" is not a scope step`);
      continue;
    }
    if (!Array.isArray(entries)) { errors.push(`bank "${key}" is not an array`); continue; }
    for (const e of entries) {
      const w = e && e.w;
      if (typeof w !== 'string' || !/^[a-z]+$/.test(w)) { err(w, step, 'w must be lowercase a-z'); continue; }
      if (e.step !== step) err(w, step, `entry.step is ${e.step}, but it is in bank ${step}`);
      if (where.has(w)) err(w, step, `also in bank ${where.get(w)}`);
      else where.set(w, step);
      if (allHearts.has(w)) err(w, step, 'is also a heart word');
      if ('name' in e && e.name !== true) err(w, step, 'name must be true if present');

      if (!Array.isArray(e.g) || e.g.length === 0) { err(w, step, 'g must be a non-empty array'); continue; }
      let ok = true;
      for (const gr of e.g) {
        if (!Array.isArray(gr) || gr.length !== 2 || typeof gr[0] !== 'string' || gr[0] === '') {
          err(w, step, `bad grapheme ${JSON.stringify(gr)}`); ok = false; continue;
        }
        const [t, k] = gr;
        if (!KINDS.includes(k)) { err(w, step, `bad kind "${k}" on "${t}"`); ok = false; continue; }
        if (!permitted[step].has(`${t}:${k}`)) err(w, step, `grapheme "${t}" (${k}) is not taught by step ${step}`);
      }
      if (!ok) continue;
      const joined = e.g.map((x) => x[0]).join('');
      if (joined !== w) err(w, step, `graphemes join to "${joined}"`);

      if (step <= 3) {
        const vowels = e.g.filter((x) => x[1] === 'v').length;
        if (vowels !== 1) err(w, step, `has ${vowels} vowel graphemes; steps 1-3 are one-syllable`);
        for (let i = 1; i < e.g.length; i++) {
          if (CONSONANT_KINDS.has(e.g[i - 1][1]) && CONSONANT_KINDS.has(e.g[i][1])) {
            err(w, step, `consonant cluster "${e.g[i - 1][0]}${e.g[i][0]}" before step 4`);
          }
        }
      }

      const needsSounds = e.g.some((x) => AMBIGUOUS.includes(x[0]) && x[1] !== 'v' && x[1] !== 'c');
      if (e.sounds !== undefined) {
        if (!Array.isArray(e.sounds) || e.sounds.length !== e.g.length) {
          err(w, step, 'sounds must have one item per grapheme');
        } else {
          e.sounds.forEach((snd, i) => {
            const [t, sound, extra] = String(snd).split(':');
            if (t !== e.g[i][0] || extra !== undefined || sound === '') err(w, step, `sounds[${i}] "${snd}" does not match grapheme "${e.g[i][0]}"`);
            if (AMBIGUOUS.includes(e.g[i][0]) && e.g[i][1] !== 'v' && e.g[i][1] !== 'c' && sound === undefined) {
              err(w, step, `sounds[${i}] must name the sound of ambiguous "${t}"`);
            }
            if (snd === 's:z' && step < 4) err(w, step, 's as /z/ is not taught before step 4');
            if (snd === 'ow:ou' && step < ouStep) err(w, step, `ow as in cow is not taught before step ${ouStep}`);
          });
        }
      } else if (needsSounds) {
        err(w, step, 'has an ambiguous grapheme but no sounds');
      }
    }
  }
  return errors;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let banks, scope;
  try {
    banks = JSON.parse(readFileSync(path.join(root, 'data/word-banks.json'), 'utf8'));
    scope = JSON.parse(readFileSync(path.join(root, 'data/scope-sequence.json'), 'utf8'));
  } catch (e) {
    console.error(`check-bank: cannot read data files: ${e.message}`);
    process.exit(2);
  }
  const errors = checkBank(banks, scope);
  if (errors.length) {
    console.error(`check-bank: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const counts = Object.entries(banks).map(([s, es]) => `${s}:${es.length}`).join(' ');
  const total = Object.values(banks).reduce((n, es) => n + es.length, 0);
  const hearts = heartWords(scope.length, scope).size;
  console.log(`check-bank: ok — ${total} entries (${counts}), ${hearts} heart words`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
