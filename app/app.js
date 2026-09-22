// Decodable Reader — the reading app. Ports docs/prototype.html's interaction
// model onto the shared lib/ modules and the server's /api/progress.
//
// Never calls anything but this server: data/, stories/, /api/progress.
// Every story is validated on load (R2); a failing story is never shown.

import { buildIndex, heartWords, allowedWords, entryFor } from '../lib/bank.js';
import { validateStory, formatError } from '../lib/validate.js';
import { segment, isHeartWord, splitToken } from '../lib/segment.js';
import { pickStory, MAX_READS } from '../lib/rotation.js';
import {
  defaultProgress, normalizeProgress, setCurrentStory, setReads,
  recordSession, promote, warmupWords, readiness,
} from '../lib/progress.js';

const SAVE_DELAY = 400;
const LONG_PRESS = 500;
const TRAY_EMPTY = '<p class="empty">Tap any word above or in the story to see its sounds.</p>';

const $ = (id) => document.getElementById(id);
const el = {
  stepLabel: $('stepLabel'), loading: $('loading'), reading: $('reading'),
  warmup: $('warmup'), heart: $('heart'), tray: $('tray'), story: $('story'),
  dots: $('dots'), pacer: $('pacer'), lineCount: $('lineCount'),
  markBtn: $('markBtn'), paceBtn: $('paceBtn'), stumbleBtn: $('stumbleBtn'),
  stumbleHint: $('stumbleHint'), finishBtn: $('finishBtn'), printBtn: $('printBtn'),
  emptyPool: $('emptyPool'), session: $('session'), sessionStory: $('sessionStory'),
  sessionCount: $('sessionCount'), sessionWords: $('sessionWords'),
  sessionTrend: $('sessionTrend'), backBtn: $('backBtn'), saveNote: $('saveNote'),
  readiness: $('readiness'), skippedNote: $('skippedNote'),
  differentBtn: $('differentBtn'), promoteWrap: $('promoteWrap'), promoteBtn: $('promoteBtn'),
  promoteConfirm: $('promoteConfirm'), promoteAsk: $('promoteAsk'),
  promoteYes: $('promoteYes'), promoteNo: $('promoteNo'),
  backStepWrap: $('backStepWrap'), backStepBtn: $('backStepBtn'),
  backStepConfirm: $('backStepConfirm'), backStepAsk: $('backStepAsk'),
  backStepYes: $('backStepYes'), backStepNo: $('backStepNo'),
  themeBtn: $('themeBtn'),
};

const state = {
  scope: [],
  banks: {},
  index: new Map(),
  step: 1,
  hearts: new Set(),
  pool: [],
  skipped: 0,
  story: null,
  progress: defaultProgress(),
  canSave: true,
  colour: false,
  paced: false,
  lineIdx: 0,
  stumbleMode: false,
  marks: new Map(), // token key -> lowercase word, for this reading
};

// ---------------------------------------------------------------- helpers

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function stepInfo(step) {
  return state.scope.find((s) => s.id === step) || null;
}

function maxStep() {
  return state.scope.reduce((m, s) => Math.max(m, s.id), 1);
}

// The word as the tray names it: bank names keep their capital, "I" stays
// a capital, the rest lowercase.
function sayWord(word) {
  const lw = word.toLowerCase();
  if (lw === 'i') return 'I';
  const e = entryFor(word, state.index);
  return e && e.name ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    const err = new Error(`${url}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------- saving

let saveTimer = null;
let savePending = false;

function commit(next) {
  state.progress = next;
  scheduleSave();
}

function scheduleSave() {
  if (!state.canSave) return;
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.canSave || !savePending) return;
  savePending = false;
  try {
    const res = await fetch('api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.progress),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showSaveNote('');
  } catch (err) {
    console.warn('progress not saved:', err);
    // Keep the in-memory state; the next change tries again.
    showSaveNote('Not saved — is the computer running?');
  }
}

function showSaveNote(text) {
  el.saveNote.textContent = text;
  el.saveNote.hidden = !text;
}

// Flush a pending save if the page is closed inside the debounce window.
window.addEventListener('pagehide', () => {
  if (!state.canSave || !savePending) return;
  savePending = false;
  try {
    fetch('api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.progress),
      keepalive: true,
    });
  } catch { /* nothing more to do */ }
});

// ---------------------------------------------------------------- loading

async function loadPool(step) {
  let raw;
  try {
    raw = await getJson(`stories/step-${step}.json`);
  } catch (err) {
    if (err.status !== 404) console.warn(`could not load stories for step ${step}:`, err);
    return { pool: [], skipped: 0 };
  }
  const list = raw && Array.isArray(raw.stories) ? raw.stories : [];
  if (!raw || raw.step !== step) console.warn(`stories/step-${step}.json: pool step is ${raw && raw.step}`);
  const allowed = allowedWords(step, state.banks, state.scope);
  const pool = [];
  const ids = new Set();
  let skipped = 0;
  for (const story of list) {
    const r = validateStory(story, { step, allowed });
    let problems = r.ok ? [] : r.errors.map(formatError);
    if (r.ok && (typeof story.id !== 'string' || ids.has(story.id))) problems = ['missing or duplicate id'];
    if (problems.length) {
      skipped++;
      const name = story && typeof story === 'object' ? `${story.id} "${story.title}"` : String(story);
      console.warn(`Skipped story ${name} at step ${step}: ${problems.join('; ')}`);
      continue;
    }
    ids.add(story.id);
    pool.push(story);
  }
  return { pool, skipped };
}

async function enterStep(step) {
  state.step = step;
  state.hearts = heartWords(step, state.scope);
  const { pool, skipped } = await loadPool(step);
  state.pool = pool;
  state.skipped = skipped;
  chooseStory();
  renderAll();
}

function chooseStory() {
  const step = state.step;
  const story = pickStory(state.pool, state.progress, step);
  state.story = story;
  resetReading();
  if (story && state.progress.current_story[step] !== story.id) {
    commit(setCurrentStory(state.progress, step, story.id));
  }
}

function resetReading() {
  state.marks = new Map();
  state.lineIdx = 0;
}

// ---------------------------------------------------------------- tray

function trayHeart(word) {
  el.tray.innerHTML =
    `<div class="tray-graph"><span class="g heartword">${esc(word)}</span></div>` +
    `<p class="tray-say">A heart word. Just tell him: <strong>${esc(sayWord(word))}</strong>. It doesn't follow the rules yet.</p>`;
}

function showSounds(word) {
  if (!word) return;
  if (isHeartWord(word, state.hearts)) return trayHeart(word);
  const gs = segment(word, state.index);
  if (!gs.length) return;
  const parts = gs.map((g) => `<span class="g ${g.k}">${esc(g.t)}</span>`);
  const says = gs.filter((g) => g.sound).map((g) => `<span class="snd">${esc(g.sound)}</span>`);
  const silent = gs.some((g) => g.k === 's');
  el.tray.innerHTML =
    `<div class="tray-graph">${parts.join('<span class="sep">&#183;</span>')}</div>` +
    `<p class="tray-say">${says.join(' ')} &rarr; <strong>${esc(sayWord(word))}</strong>` +
    (silent ? ' &nbsp;· the <b>e</b> is silent — it makes the vowel say its name.' : '') +
    '</p>';
}

function clearPicked() {
  for (const n of document.querySelectorAll('.w.picked, .chip.picked')) n.classList.remove('picked');
}

// ---------------------------------------------------------------- render

function renderStepLabel() {
  const info = stepInfo(state.step);
  el.stepLabel.innerHTML = info
    ? `<b>${esc(info.tag)}</b>${esc(info.name)}`
    : `<b>Step ${state.step}</b>`;
}

function renderChips() {
  const story = state.story;
  el.warmup.innerHTML = '';
  const words = warmupWords(state.progress, story, state.index, today(), { hearts: state.hearts, step: state.step });
  for (const w of words) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    if (isHeartWord(w, state.hearts)) b.classList.add('heart');
    b.textContent = sayWord(w);
    b.addEventListener('click', () => { clearPicked(); b.classList.add('picked'); showSounds(w); });
    el.warmup.appendChild(b);
  }

  el.heart.innerHTML = '';
  const inStory = [];
  const texts = [story.title, ...story.lines];
  for (const text of texts) {
    for (const tok of text.split(/\s+/)) {
      const { word } = splitToken(tok);
      const lw = word.toLowerCase();
      if (word && state.hearts.has(lw) && !inStory.includes(lw)) inStory.push(lw);
    }
  }
  const hearts = inStory.length ? inStory : [...state.hearts];
  for (const w of hearts) {
    const s = document.createElement('span');
    s.className = 'chip heart';
    s.textContent = sayWord(w);
    el.heart.appendChild(s);
  }
}

// One story token -> DOM nodes; words become tappable .w spans.
function renderToken(parent, tok, key) {
  const { pre, word, post } = splitToken(tok);
  if (pre) parent.appendChild(document.createTextNode(pre));
  if (word) {
    const span = document.createElement('span');
    span.className = 'w';
    span.dataset.key = key;
    span.dataset.word = word;
    if (isHeartWord(word, state.hearts)) {
      span.classList.add('heartword');
      span.textContent = word;
    } else {
      for (const g of segment(word, state.index)) {
        const seg = document.createElement('span');
        seg.className = g.k;
        seg.textContent = g.t;
        span.appendChild(seg);
      }
    }
    if (state.marks.has(key)) span.classList.add('stumble');
    parent.appendChild(span);
  }
  if (post) parent.appendChild(document.createTextNode(post));
}

function renderText(parent, text, prefix) {
  text.split(/\s+/).filter(Boolean).forEach((tok, ti) => {
    if (ti) parent.appendChild(document.createTextNode(' '));
    renderToken(parent, tok, `${prefix}.${ti}`);
  });
}

function renderStory() {
  const story = state.story;
  el.story.innerHTML = '';
  const h = document.createElement('h2');
  h.className = 'story-title';
  renderText(h, story.title, 't');
  el.story.appendChild(h);
  story.lines.forEach((line, li) => {
    const p = document.createElement('p');
    p.className = 'line';
    renderText(p, line, String(li));
    el.story.appendChild(p);
  });
  el.story.classList.toggle('marked', state.colour);
  applyPacing();
}

function renderDots() {
  const id = state.story.id;
  const n = state.progress.reads[id] || 0;
  el.dots.innerHTML = '';
  for (let k = 0; k < MAX_READS; k++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'dot';
    d.setAttribute('data-on', k < n ? '1' : '0');
    d.setAttribute('aria-label', `Read-through ${k + 1}`);
    d.setAttribute('aria-pressed', k < n ? 'true' : 'false');
    d.addEventListener('click', () => {
      const cur = state.progress.reads[id] || 0;
      commit(setReads(state.progress, id, cur === k + 1 ? k : k + 1));
      renderDots();
      renderGrownup();
    });
    el.dots.appendChild(d);
  }
}

function applyPacing() {
  const lines = el.story.querySelectorAll('.line');
  el.story.classList.toggle('paced', state.paced);
  el.pacer.classList.toggle('on', state.paced);
  lines.forEach((l, i) => l.classList.toggle('on', i === state.lineIdx));
  el.lineCount.textContent = state.paced ? `${state.lineIdx + 1} of ${lines.length}` : '';
}

function move(delta) {
  if (!state.story) return;
  const total = state.story.lines.length;
  state.lineIdx = Math.max(0, Math.min(total - 1, state.lineIdx + delta));
  applyPacing();
}

function readinessText(step) {
  const r = readiness(state.progress, step);
  if (r.stories_read === 0 && r.sessions === 0) return `Nothing read at step ${step} yet.`;
  const parts = [`${plural(r.stories_read, 'story', 'stories')} at step ${step}`];
  if (r.stories_read) {
    parts.push(Number.isInteger(r.avg_reads)
      ? `${plural(r.avg_reads, 'read', 'reads')} each`
      : `${r.avg_reads} reads each on average`);
  }
  if (r.sessions >= 2) {
    const a = r.first_session_stumbles;
    const b = r.last_session_stumbles;
    if (b < a) parts.push(`stumbles down from ${a} to ${b}`);
    else if (b > a) parts.push(`stumbles up from ${a} to ${b}`);
    else parts.push(`stumbles steady at ${a}`);
  } else if (r.sessions === 1) {
    parts.push(`${plural(r.last_session_stumbles, 'stumble', 'stumbles')} in the one session so far`);
  }
  return parts.join(', ') + '.';
}

function renderGrownup() {
  const step = state.step;
  el.readiness.textContent = readinessText(step);

  el.skippedNote.hidden = state.skipped === 0;
  el.skippedNote.textContent = state.skipped === 1
    ? '1 story was skipped because it failed the word check.'
    : `${state.skipped} stories were skipped because they failed the word check.`;

  el.differentBtn.hidden = state.pool.length < 2;

  const next = step + 1;
  el.promoteWrap.hidden = next > maxStep();
  el.promoteBtn.textContent = `Move to step ${next}`;
  el.promoteAsk.textContent = `Move him to step ${next}?`;
  el.promoteBtn.hidden = false;
  el.promoteConfirm.hidden = true;

  el.backStepWrap.hidden = step <= 1;
  el.backStepBtn.textContent = 'Go back a step';
  el.backStepAsk.textContent = `Go back to step ${step - 1}?`;
  el.backStepBtn.hidden = false;
  el.backStepConfirm.hidden = true;
}

function renderEmptyPool() {
  const s = state.step;
  el.emptyPool.innerHTML =
    `<p><b>No stories for step ${s} yet.</b></p>` +
    `<p>On the computer that runs this app, make some with <code>npm run generate -- --step ${s}</code>, then reload this page.</p>` +
    (state.skipped ? '<p>Some stories were found but none passed the word check — see the note under "How to run this".</p>' : '');
}

function renderAll() {
  el.loading.hidden = true;
  renderStepLabel();
  renderGrownup();
  showSession(false);
  const has = !!state.story;
  el.reading.hidden = !has;
  el.emptyPool.hidden = has;
  if (!has) { renderEmptyPool(); return; }
  el.tray.innerHTML = TRAY_EMPTY;
  renderChips();
  renderStory();
  renderDots();
  setStumbleMode(state.stumbleMode);
}

// ---------------------------------------------------------------- stumbles

function setStumbleMode(on) {
  state.stumbleMode = on;
  el.stumbleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.story.classList.toggle('stumbling', on);
  el.stumbleHint.hidden = !on;
}

function toggleMark(span) {
  const key = span.dataset.key;
  if (state.marks.has(key)) {
    state.marks.delete(key);
    span.classList.remove('stumble');
  } else {
    state.marks.set(key, span.dataset.word.toLowerCase());
    span.classList.add('stumble');
  }
}

let press = null; // { span, timer, x, y, fired }
let suppressClick = null;

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

el.story.addEventListener('pointerdown', (e) => {
  const span = e.target.closest('.w');
  suppressClick = null;
  cancelPress();
  if (!span || (e.pointerType === 'mouse' && e.button !== 0)) return;
  press = {
    span, x: e.clientX, y: e.clientY,
    timer: setTimeout(() => {
      toggleMark(span);
      suppressClick = span;
      press = null;
    }, LONG_PRESS),
  };
});
el.story.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
});
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
  el.story.addEventListener(t, cancelPress);
}
el.story.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.w')) e.preventDefault();
});
el.story.addEventListener('click', (e) => {
  const span = e.target.closest('.w');
  if (!span) return;
  if (suppressClick === span) { suppressClick = null; return; }
  if (state.stumbleMode) { toggleMark(span); return; }
  clearPicked();
  span.classList.add('picked');
  showSounds(span.dataset.word);
});

// ---------------------------------------------------------------- session view

function showSession(on) {
  el.session.hidden = !on;
  if (state.story) el.reading.hidden = on;
  if (on) window.scrollTo(0, 0);
}

function titleFor(id) {
  const s = state.pool.find((x) => x.id === id);
  return s ? s.title : id || 'a story';
}

function finish() {
  const story = state.story;
  const words = [...new Set(state.marks.values())];
  commit(recordSession(state.progress, { story_id: story.id, step: state.step, stumbles: words, date: today() }));

  el.sessionStory.textContent = story.title;
  el.sessionCount.textContent = words.length
    ? `${plural(words.length, 'word', 'words')} marked:`
    : 'No words marked.';
  el.sessionWords.innerHTML = '';
  for (const w of words) {
    const s = document.createElement('span');
    s.className = 'chip plain';
    if (state.hearts.has(w)) s.classList.add('heart');
    s.textContent = sayWord(w);
    el.sessionWords.appendChild(s);
  }

  const last = state.progress.sessions.slice(-5);
  const most = Math.max(1, ...last.map((s) => s.stumbles.length));
  el.sessionTrend.innerHTML = '';
  for (const s of last) {
    const li = document.createElement('li');
    const n = s.stumbles.length;
    li.innerHTML =
      `<span class="what">${esc(s.date || '')} · ${esc(titleFor(s.story_id))}</span>` +
      `<span class="bar" aria-hidden="true"><i style="width:${Math.round((n / most) * 100)}%"></i></span>` +
      `<span class="n">${n}</span>`;
    el.sessionTrend.appendChild(li);
  }

  resetReading();
  renderStory();
  renderGrownup();
  showSession(true);
}

// ---------------------------------------------------------------- controls

el.markBtn.addEventListener('click', () => {
  state.colour = !state.colour;
  el.story.classList.toggle('marked', state.colour);
  el.markBtn.setAttribute('aria-pressed', state.colour ? 'true' : 'false');
});
el.paceBtn.addEventListener('click', () => {
  state.paced = !state.paced;
  state.lineIdx = 0;
  el.paceBtn.setAttribute('aria-pressed', state.paced ? 'true' : 'false');
  applyPacing();
});
$('prevLine').addEventListener('click', () => move(-1));
$('nextLine').addEventListener('click', () => move(1));
el.stumbleBtn.addEventListener('click', () => setStumbleMode(!state.stumbleMode));
el.printBtn.addEventListener('click', () => window.print());
el.finishBtn.addEventListener('click', finish);
el.backBtn.addEventListener('click', () => showSession(false));

document.addEventListener('keydown', (e) => {
  if (!state.paced || !el.reading.offsetParent) return;
  if (e.target.closest && e.target.closest('button, summary') && e.key === ' ') return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); move(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
});

el.differentBtn.addEventListener('click', () => {
  const step = state.step;
  // Drop the current story (it becomes last_story), then pick again.
  const skipped = setCurrentStory(state.progress, step, null);
  const story = pickStory(state.pool, skipped, step);
  commit(story ? setCurrentStory(skipped, step, story.id) : skipped);
  state.story = story;
  resetReading();
  renderAll();
});

function confirmPair(btn, box, yes, no, action) {
  btn.addEventListener('click', () => { btn.hidden = true; box.hidden = false; yes.focus(); });
  no.addEventListener('click', () => { box.hidden = true; btn.hidden = false; btn.focus(); });
  yes.addEventListener('click', action);
}

async function changeStep(to) {
  commit(promote(state.progress, to, today()));
  el.reading.hidden = true;
  el.loading.hidden = false;
  await enterStep(to);
}

confirmPair(el.promoteBtn, el.promoteConfirm, el.promoteYes, el.promoteNo, () => changeStep(state.step + 1));
confirmPair(el.backStepBtn, el.backStepConfirm, el.backStepYes, el.backStepNo, () => changeStep(state.step - 1));

// Theme: a per-device convenience, remembered in this browser only.
function systemDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  const dark = theme ? theme === 'dark' : systemDark();
  el.themeBtn.textContent = dark ? 'Light' : 'Dark';
}
try { applyTheme(localStorage.getItem('reader:theme')); } catch { applyTheme(null); }
el.themeBtn.addEventListener('click', () => {
  const dark = el.themeBtn.textContent === 'Light';
  const theme = dark ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('reader:theme', theme); } catch { /* private mode */ }
});

// ---------------------------------------------------------------- start

async function start() {
  let scope, banks;
  try {
    [scope, banks] = await Promise.all([getJson('data/scope-sequence.json'), getJson('data/word-banks.json')]);
  } catch (err) {
    console.error(err);
    el.loading.textContent = 'Could not load the word lists — is the computer running? Reload to try again.';
    return;
  }
  state.scope = Array.isArray(scope) ? scope : [];
  state.banks = banks || {};
  state.index = buildIndex(state.banks);

  try {
    state.progress = normalizeProgress(await getJson('api/progress'));
  } catch (err) {
    console.error('could not load progress:', err);
    // Saving now would overwrite the real progress with a fresh start.
    state.canSave = false;
    state.progress = defaultProgress();
    showSaveNote('Progress could not be loaded, so nothing will be saved. Reload the page to try again.');
  }
  const step = Math.min(Math.max(1, state.progress.current_step), maxStep());
  await enterStep(step);
}

start();
