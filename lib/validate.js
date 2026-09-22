// Story validator (spec §3 "Validator"). Shared by the Node scripts and the
// browser — no Node-only imports. Deliberately dumb and strict: split on
// whitespace, strip punctuation, lowercase, exact set membership. No stemming.
// If this and the generator disagree, this wins.
//
// validateStory(story, { step, banks, scope, allowed? }) -> { ok, errors, words }
//   ok      true iff errors is empty
//   errors  every problem found (not just the first), each one of:
//     { code: 'not_object' }                      story is not a plain object
//     { code: 'step_mismatch', expected, got }    story.step !== step
//     { code: 'bad_title' }                       title missing or not a non-empty string
//     { code: 'bad_lines' }                       lines missing or not a non-empty array
//     { code: 'bad_line', line }                  lines[line] is not a string
//     { code: 'empty_line', line }                lines[line] has no words
//     { code: 'bad_token', token, line }          token has a digit or no letters but
//                                                 something other than punctuation
//     { code: 'word', word, line }                word not allowed at this step
//                                                 (includes any word with an apostrophe
//                                                 that is not itself in the lists)
//     { code: 'too_few_lines', count, min }       fewer than 5 lines
//     { code: 'line_too_long', line, count, max } a line over 9 words
//     { code: 'duplicate_line', line, first }     lines[line] repeats lines[first]
//                                                 (compared as their word lists)
//     { code: 'low_variety', distinct, total }    distinct words < 60% of total words
//   `line` is the 0-based index into story.lines, or 'title' for the title.
//   words   distinct lowercase words of title + lines, in first-seen order
//           (what the generator stores as words_used)
//
// `allowed` (a Set of lowercase words) may be passed to skip recomputing
// allowedWords(step, banks, scope) when validating a whole pool.

import { allowedWords } from './bank.js';

export const MIN_LINES = 5;
export const MAX_WORDS_PER_LINE = 9;
export const MIN_DISTINCT_RATIO = 0.6;

// One whitespace-separated token -> lowercase word, '' if it is pure
// punctuation, or null if it can't be a word (contains a digit or a symbol
// between letters other than an apostrophe). Curly apostrophes count as
// apostrophes. Apostrophes are kept only between letters ("don't"), leading and
// trailing ones are stripped ("'cat'" -> "cat").
export function normalizeToken(token) {
  const t = String(token).replace(/[‘’ʼ]/g, "'");
  if (/[0-9]/.test(t)) return null;
  const m = /[A-Za-z](?:.*[A-Za-z])?/.exec(t);
  if (!m) return '';
  const core = m[0];
  if (/[^A-Za-z']/.test(core)) return null;
  return core.toLowerCase();
}

// Words of one line, in order, lowercased, punctuation stripped. Tokens that
// normalizeToken rejects are dropped here — validateStory reports them.
export function tokenize(line) {
  const out = [];
  for (const tok of String(line).split(/\s+/)) {
    const w = normalizeToken(tok);
    if (w) out.push(w);
  }
  return out;
}

function checkWords(text, line, allowed, errors, words, seenWords) {
  const out = [];
  for (const tok of text.split(/\s+/)) {
    if (!tok) continue;
    const w = normalizeToken(tok);
    if (w === '') continue;
    if (w === null) { errors.push({ code: 'bad_token', token: tok, line }); continue; }
    if (!allowed.has(w)) errors.push({ code: 'word', word: w, line });
    if (!seenWords.has(w)) { seenWords.add(w); words.push(w); }
    out.push(w);
  }
  return out;
}

export function validateStory(story, ctx) {
  const errors = [];
  const words = [];
  if (!story || typeof story !== 'object' || Array.isArray(story)) {
    return { ok: false, errors: [{ code: 'not_object' }], words };
  }
  const { step } = ctx;
  const allowed = ctx.allowed || allowedWords(step, ctx.banks, ctx.scope);
  const seenWords = new Set();

  if (story.step !== step) errors.push({ code: 'step_mismatch', expected: step, got: story.step });

  if (typeof story.title !== 'string' || !story.title.trim()) errors.push({ code: 'bad_title' });
  else checkWords(story.title, 'title', allowed, errors, words, seenWords);

  if (!Array.isArray(story.lines) || story.lines.length === 0) {
    errors.push({ code: 'bad_lines' });
    return { ok: false, errors, words };
  }

  let total = 0;
  const bodyWords = new Set();
  const firstIndex = new Map();
  story.lines.forEach((text, i) => {
    if (typeof text !== 'string') { errors.push({ code: 'bad_line', line: i }); return; }
    const lw = checkWords(text, i, allowed, errors, words, seenWords);
    if (lw.length === 0) { errors.push({ code: 'empty_line', line: i }); return; }
    if (lw.length > MAX_WORDS_PER_LINE) {
      errors.push({ code: 'line_too_long', line: i, count: lw.length, max: MAX_WORDS_PER_LINE });
    }
    const key = lw.join(' ');
    if (firstIndex.has(key)) errors.push({ code: 'duplicate_line', line: i, first: firstIndex.get(key) });
    else firstIndex.set(key, i);
    total += lw.length;
    for (const w of lw) bodyWords.add(w);
  });

  if (story.lines.length < MIN_LINES) {
    errors.push({ code: 'too_few_lines', count: story.lines.length, min: MIN_LINES });
  }
  if (total > 0 && bodyWords.size < MIN_DISTINCT_RATIO * total) {
    errors.push({ code: 'low_variety', distinct: bodyWords.size, total });
  }

  return { ok: errors.length === 0, errors, words };
}

// One-line human description of an error, for the CLI and the app's console.
export function formatError(e) {
  const where = e.line === 'title' ? 'title' : e.line !== undefined ? `line ${e.line + 1}` : '';
  const at = where ? ` (${where})` : '';
  switch (e.code) {
    case 'word': return `word not allowed: "${e.word}"${at}`;
    case 'bad_token': return `not a word: ${JSON.stringify(e.token)}${at}`;
    case 'step_mismatch': return `story.step is ${JSON.stringify(e.got)}, expected ${e.expected}`;
    case 'too_few_lines': return `${e.count} lines, need at least ${e.min}`;
    case 'line_too_long': return `${e.count} words, max ${e.max}${at}`;
    case 'duplicate_line': return `duplicates line ${e.first + 1}${at}`;
    case 'low_variety': return `${e.distinct} distinct of ${e.total} words (< ${MIN_DISTINCT_RATIO * 100}%)`;
    case 'empty_line': return `no words${at}`;
    case 'bad_line': return `not a string${at}`;
    case 'bad_title': return 'title missing or empty';
    case 'bad_lines': return 'lines missing or empty';
    case 'not_object': return 'story is not an object';
    default: return `${e.code}${at}`;
  }
}
