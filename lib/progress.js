// Progress model shared by the server and the browser. No Node-only imports.
//
// Shape (the spec's progress object plus `sessions`, and per-step
// `current_story` / `last_story` maps keyed by step number):
//   current_step  integer >= 1
//   reads         { storyId: count }
//   stumbles      { word: count }
//   seen          [storyId]
//   step_history  [{ step, promoted_at }]  promote() adds `to`; `step` = step left
//   sessions      [object]               recordSession() writes
//                                        { story_id, step, date, stumbles: [word] }
//   current_story { step: storyId }
//   last_story    { step: storyId }

import { tokenize } from './validate.js';

export function defaultProgress() {
  return {
    current_step: 1,
    reads: {},
    stumbles: {},
    seen: [],
    step_history: [],
    sessions: [],
    current_story: {},
    last_story: {},
  };
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isCount(n) {
  return Number.isInteger(n) && n >= 0;
}

// Keep only entries of a plain object whose values pass `ok`.
function filterMap(x, ok) {
  const out = {};
  if (!isPlainObject(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (ok(v)) out[k] = v;
  }
  return out;
}

// Accepts anything (parsed JSON, a JSON string, garbage) and returns a valid
// progress object. Wrong-typed fields fall back to their defaults. Never throws.
export function normalizeProgress(x) {
  const p = defaultProgress();
  try {
    if (typeof x === 'string') {
      try {
        x = JSON.parse(x);
      } catch {
        return p;
      }
    }
    if (!isPlainObject(x)) return p;

    if (Number.isInteger(x.current_step) && x.current_step >= 1) {
      p.current_step = x.current_step;
    }
    p.reads = filterMap(x.reads, isCount);
    p.stumbles = filterMap(x.stumbles, isCount);
    if (Array.isArray(x.seen)) {
      p.seen = [...new Set(x.seen.filter((s) => typeof s === 'string'))];
    }
    if (Array.isArray(x.step_history)) {
      p.step_history = x.step_history.filter(
        (h) =>
          isPlainObject(h) &&
          Number.isInteger(h.step) &&
          h.step >= 1 &&
          typeof h.promoted_at === 'string',
      );
    }
    if (Array.isArray(x.sessions)) {
      p.sessions = x.sessions.filter(isPlainObject);
    }
    p.current_story = filterMap(x.current_story, (v) => typeof v === 'string');
    p.last_story = filterMap(x.last_story, (v) => typeof v === 'string');
  } catch {
    return defaultProgress();
  }
  return p;
}

// ---------------------------------------------------------------------------
// Pure helpers (step 6). Each takes a progress object and returns a NEW,
// normalized progress object; the input is never changed. Dates are strings
// the caller supplies ('YYYY-MM-DD', the device's local date) — nothing here
// reads the clock.


export const MAX_READS = 3;
export const MAX_SESSIONS = 60;
export const MAX_WARMUP_STUMBLES = 6;
export const MAX_WARMUP = 14;

function copy(progress) {
  let plain;
  try {
    plain = JSON.parse(JSON.stringify(progress ?? null));
  } catch {
    plain = null;
  }
  return normalizeProgress(plain);
}

function cleanWord(w) {
  return typeof w === 'string' ? w.trim().toLowerCase() : '';
}

// Make `storyId` the current story for `step`. The story it replaces (if
// different) becomes last_story[step], so pickStory will not serve it next.
export function setCurrentStory(progress, step, storyId) {
  const p = copy(progress);
  const prev = p.current_story[step];
  if (typeof prev === 'string' && prev !== storyId) p.last_story[step] = prev;
  if (typeof storyId === 'string') p.current_story[step] = storyId;
  else delete p.current_story[step];
  return p;
}

// Set the repeated-reading dots for a story, clamped to an integer 0..3.
// 0 removes the entry.
export function setReads(progress, storyId, n) {
  const p = copy(progress);
  if (typeof storyId !== 'string') return p;
  const v = Math.min(MAX_READS, Math.max(0, Math.trunc(Number(n)) || 0));
  if (v === 0) delete p.reads[storyId];
  else p.reads[storyId] = v;
  return p;
}

// Record one finished reading. Appends
//   { story_id, step, date, stumbles: [distinct lowercase words] }
// to sessions (keeping the last 60), adds 1 to stumbles[w] for each distinct
// marked word, and adds story_id to seen.
export function recordSession(progress, { story_id, step, stumbles = [], date } = {}) {
  const p = copy(progress);
  const words = [];
  for (const w of Array.isArray(stumbles) ? stumbles : []) {
    const c = cleanWord(w);
    if (c && !words.includes(c)) words.push(c);
  }
  const session = { story_id: typeof story_id === 'string' ? story_id : null, step, date, stumbles: words };
  p.sessions = [...p.sessions, session].slice(-MAX_SESSIONS);
  for (const w of words) p.stumbles[w] = (p.stumbles[w] || 0) + 1;
  if (typeof story_id === 'string' && !p.seen.includes(story_id)) p.seen.push(story_id);
  return p;
}

// Manual step change (promotion, or going back a step). Appends
//   { step: <step left>, to: toStep, promoted_at: date }
// to step_history — the spec's example records the step that was left
// ({step:1} while current_step is 2) — and sets current_step. Moving to the
// current step is a no-op. Throws on a toStep that is not an integer >= 1.
export function promote(progress, toStep, date) {
  if (!Number.isInteger(toStep) || toStep < 1) throw new RangeError(`bad step: ${toStep}`);
  const p = copy(progress);
  if (toStep === p.current_step) return p;
  p.step_history = [...p.step_history, { step: p.current_step, to: toStep, promoted_at: String(date) }];
  p.current_step = toStep;
  return p;
}

function displayWord(entry, w) {
  return entry && entry.name ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

// Words for the warm-up strip, in order:
//   1. up to 6 words the child stumbled on in sessions dated before `today`,
//      most-stumbled first (count of those sessions that marked it; ties:
//      most recently marked, then alphabetical), restricted to words allowed
//      at the current step — bank words of steps 1..step, plus opts.hearts
//      (a Set of lowercase heart words) if given;
//   2. then the story's words (title and lines, in reading order) that are in
//      the current step's own bank;
// deduped, at most 14. Words are lowercase except bank names, which are
// capitalised ("Jack"). `index` is buildIndex(banks); opts.step defaults to
// progress.current_step.
export function warmupWords(progress, story, index, today, opts = {}) {
  const p = copy(progress);
  const step = Number.isInteger(opts.step) ? opts.step : p.current_step;
  const hearts = opts.hearts instanceof Set ? opts.hearts : new Set();
  const lookup = (w) => (index && typeof index.get === 'function' ? index.get(w) : undefined);
  const out = [];
  const have = new Set();
  const add = (w, entry) => {
    if (have.has(w) || out.length >= MAX_WARMUP) return;
    have.add(w);
    out.push(displayWord(entry, w));
  };

  const count = new Map();
  const recent = new Map();
  p.sessions.forEach((s, i) => {
    if (typeof s.date !== 'string' || typeof today !== 'string' || !(s.date.slice(0, 10) < today.slice(0, 10))) return;
    const ws = new Set((Array.isArray(s.stumbles) ? s.stumbles : []).map(cleanWord).filter(Boolean));
    for (const w of ws) {
      count.set(w, (count.get(w) || 0) + 1);
      recent.set(w, i);
    }
  });
  const allowedStumble = (w) => {
    const e = lookup(w);
    return (e && Number.isInteger(e.step) && e.step <= step) || hearts.has(w);
  };
  const ranked = [...count.keys()]
    .filter(allowedStumble)
    .sort((a, b) => count.get(b) - count.get(a) || recent.get(b) - recent.get(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_WARMUP_STUMBLES);
  for (const w of ranked) add(w, lookup(w));

  const texts = story && typeof story === 'object'
    ? [story.title, ...(Array.isArray(story.lines) ? story.lines : [])].filter((t) => typeof t === 'string')
    : [];
  for (const text of texts) {
    for (const w of tokenize(text)) {
      const e = lookup(w);
      if (e && e.step === step) add(w, e);
    }
  }
  return out;
}

// Numbers for the grown-up's readiness hint at `step`, e.g.
// "8 stories at step 2, 3 reads each, stumbles down from 11 to 2":
//   stories_read            stories of this step with reads >= 1 (reads keys
//                           "s{step}-…", plus story ids of this step's sessions)
//   avg_reads               mean reads over those stories, 1 decimal (0 if none)
//   first_session_stumbles  stumble count of the first retained session at
//                           this step (null if none)
//   last_session_stumbles   same for the latest one (null if none)
//   sessions                number of retained sessions at this step
export function readiness(progress, step) {
  const p = copy(progress);
  const ids = new Set();
  const prefix = `s${step}-`;
  for (const [id, n] of Object.entries(p.reads)) if (id.startsWith(prefix) && n >= 1) ids.add(id);
  const at = p.sessions.filter((s) => s.step === step);
  for (const s of at) if (typeof s.story_id === 'string' && (p.reads[s.story_id] || 0) >= 1) ids.add(s.story_id);
  let total = 0;
  for (const id of ids) total += p.reads[id] || 0;
  const n = (s) => (Array.isArray(s.stumbles) ? s.stumbles.length : 0);
  return {
    stories_read: ids.size,
    avg_reads: ids.size ? Math.round((total / ids.size) * 10) / 10 : 0,
    first_session_stumbles: at.length ? n(at[0]) : null,
    last_session_stumbles: at.length ? n(at[at.length - 1]) : null,
    sessions: at.length,
  };
}
