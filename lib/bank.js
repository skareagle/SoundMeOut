// Word banks and heart words. Shared by the Node scripts and the browser —
// no Node-only imports.
//
// data/word-banks.json   { "1": [entry, ...], ..., "10": [entry, ...] }
//   entry = { w, g: [[text, kind], ...], step, name?: true, sounds?: [...] }
//   w      lowercase word; the texts of g join to w exactly
//   kind   c consonant | v vowel | d digraph (incl. ll ss ff zz, qu, ng, nk,
//          and the step-10 suffix units ed es le) | s silent | t vowel team
//          (incl. r-controlled and diphthong pairs)
//   sounds one item per grapheme: the grapheme text, or "text:sound" where the
//          grapheme is ambiguous (e.g. "ea:short-e", "s:z", "ed:t")
// data/scope-sequence.json  [{ id, tag, name, teaches, graphemes_added,
//                              structures_added, heart_words }, ...]
//
// Heart words are cumulative: heartWords(step) is the union of steps 1..step.

export const KINDS = ['c', 'v', 'd', 's', 't'];

const VOWEL_LETTERS = 'aeiou';

// Kind of every multi-letter grapheme a scope step may add. A grapheme not in
// this table (and not a single letter or an x_e split digraph) is an error in
// the scope sequence — add it here deliberately.
export const GRAPHEME_KIND = {
  sh: 'd', ch: 'd', th: 'd', ck: 'd', wh: 'd', ng: 'd', nk: 'd', qu: 'd',
  ll: 'd', ss: 'd', ff: 'd', zz: 'd',
  ed: 'd', es: 'd', le: 'd',
  ai: 't', ay: 't', ee: 't', ea: 't',
  oa: 't', ow: 't', oo: 't',
  ar: 't', or: 't', er: 't', ir: 't', ur: 't',
  oi: 't', oy: 't', ou: 't',
};

// Graphemes whose sound must be given in the entry's `sounds`.
export const AMBIGUOUS = ['ea', 'ow', 'oo', 'ou', 'ed', 'es'];

function stepNum(s) {
  return typeof s === 'number' ? s : parseInt(s, 10);
}

// The "text:kind" pairs one graphemes_added item permits.
export function graphemeKeys(item) {
  if (/^[a-z]$/.test(item)) {
    return [`${item}:${VOWEL_LETTERS.includes(item) ? 'v' : 'c'}`];
  }
  const split = /^([aeiou])_e$/.exec(item);
  if (split) return [`${split[1]}:v`, 'e:s'];
  const k = GRAPHEME_KIND[item];
  if (!k) throw new Error(`unknown grapheme in scope sequence: ${item}`);
  return [`${item}:${k}`];
}

// Set of "text:kind" permitted at or before `step`.
export function permittedGraphemes(step, scope) {
  const out = new Set();
  for (const s of scope) {
    if (s.id > step) continue;
    for (const item of s.graphemes_added || []) {
      for (const key of graphemeKeys(item)) out.add(key);
    }
  }
  return out;
}

// Map lowercase word -> entry across all banks.
export function buildIndex(banks) {
  const index = new Map();
  for (const [step, entries] of Object.entries(banks || {})) {
    for (const e of entries || []) {
      if (e && typeof e.w === 'string') index.set(e.w.toLowerCase(), { ...e, step: e.step ?? stepNum(step) });
    }
  }
  return index;
}

export function entryFor(word, index) {
  if (typeof word !== 'string') return null;
  return index.get(word.toLowerCase()) || null;
}

// Bank words (lowercase) for steps 1..step.
export function bankWords(step, banks) {
  const out = new Set();
  for (const [s, entries] of Object.entries(banks || {})) {
    if (stepNum(s) > step) continue;
    for (const e of entries || []) out.add(e.w.toLowerCase());
  }
  return out;
}

// Cumulative heart words (lowercase) for steps 1..step.
export function heartWords(step, scope) {
  const out = new Set();
  for (const s of scope || []) {
    if (s.id > step) continue;
    for (const w of s.heart_words || []) out.add(w.toLowerCase());
  }
  return out;
}

// Everything a story at `step` may contain: bank words 1..step plus
// cumulative heart words 1..step.
export function allowedWords(step, banks, scope) {
  const out = bankWords(step, banks);
  for (const w of heartWords(step, scope)) out.add(w);
  return out;
}
