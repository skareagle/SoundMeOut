// The generation prompt (spec §3 "Generation prompt shape"). Pure string
// building — no Node-only imports, so this stays usable in the browser and is
// trivial to test.
//
// buildPrompt({ step, banks, scope, focus?, rand? }) ->
//   { text, bankWords, heartWords, focus }
//     text        the user message sent to the model
//     bankWords   cumulative bank words for steps 1..step, sorted
//     heartWords  cumulative heart words for steps 1..step, sorted
//     focus       the words the prompt asks the model to feature
//
// The full allowed list always goes in the prompt (the validator is strict, so
// the model must see every legal word). With a large bank that alone produces
// samey stories, so the prompt also names 8–12 "focus words" drawn at random
// from the *current* step's own bank.

import { bankWords, heartWords } from './bank.js';

export const FOCUS_MIN = 8;
export const FOCUS_MAX = 12;

function stepNum(s) {
  return typeof s === 'number' ? s : parseInt(s, 10);
}

// The words belonging to `step` itself (not the cumulative set), sorted.
export function stepBankWords(step, banks) {
  const out = [];
  for (const [s, entries] of Object.entries(banks || {})) {
    if (stepNum(s) !== step) continue;
    for (const e of entries || []) out.push(e.w.toLowerCase());
  }
  return out.sort();
}

// `count` words chosen from `words` without replacement, using `rand`
// (a () -> [0,1) function) so tests can be deterministic.
export function pickFocusWords(words, rand = Math.random, count = FOCUS_MAX) {
  const pool = [...words];
  const n = Math.min(count, pool.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
    out.push(pool.splice(j, 1)[0]);
  }
  return out;
}

export function buildPrompt({ step, banks, scope, focus, rand = Math.random }) {
  const stepEntry = (scope || []).find((s) => s.id === step);
  const name = stepEntry ? stepEntry.name : `step ${step}`;
  const hearts = [...heartWords(step, scope)].sort();
  const heartSet = new Set(hearts);
  const bank = [...bankWords(step, banks)].filter((w) => !heartSet.has(w)).sort();

  const own = stepBankWords(step, banks).filter((w) => !heartSet.has(w));
  const chosen = focus
    ? [...focus]
    : pickFocusWords(own, rand, FOCUS_MIN + Math.floor(rand() * (FOCUS_MAX - FOCUS_MIN + 1)));

  const lines = [
    `You are writing a decodable story for a 6-year-old at phonics step ${step} (${name}).`,
    '',
    'You may use ONLY these words:',
    bank.join(' '),
    '',
    `Plus these heart words: ${hearts.join(' ')}`,
    '',
  ];
  if (chosen.length) {
    lines.push(`Feature several of these words from this step: ${chosen.join(' ')}`, '');
  }
  lines.push(
    'Rules:',
    '- 6 to 9 sentences, 3 to 7 words each.',
    '- It must be an actual story: something happens, and it ends.',
    '- Proper names allowed only if decodable at this step (Sam, Jack, Jake).',
    '- No word outside the lists above. Not one.',
    '- Vary sentence openings; do not start every line with "The".',
    '',
    'Return JSON: { "title": string, "lines": string[] }',
  );
  return { text: lines.join('\n'), bankWords: bank, heartWords: hearts, focus: chosen };
}
