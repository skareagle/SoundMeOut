// Smoke test for the reading app: served from the real repo root with a temp
// data dir. No browser — it checks what the page will ask the server for.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

let server, base, dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dr-app-'));
  server = createServer({ root: REPO, dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function appFiles() {
  const out = ['index.html'];
  for (const dir of ['app', 'lib']) {
    for (const f of await fs.readdir(path.join(REPO, dir))) {
      if (/\.(js|css)$/.test(f)) out.push(`${dir}/${f}`);
    }
  }
  return out;
}

// Static import specifiers of an ES module source.
function importsOf(src) {
  const out = [];
  const re = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] || m[2]);
  return out;
}

test('GET / serves the app page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<script type="module" src="app\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="app\/style\.css">/);
  assert.match(html, /Sound It Out/);
});

test('no references to any other host in index.html, app/ or lib/', async () => {
  for (const f of await appFiles()) {
    const src = await fs.readFile(path.join(REPO, f), 'utf8');
    for (const m of src.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?\//gi)) {
      assert.ok(LOCAL_HOSTS.has(m[1].toLowerCase()), `${f} references ${m[0]}`);
    }
    assert.doesNotMatch(src, /https?:\/\//i, `${f} contains an http(s) URL`);
    assert.doesNotMatch(src, /@import/i, `${f} uses @import`);
  }
});

test('every asset the page and stylesheet name is served', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2);
  const css = await fs.readFile(path.join(REPO, 'app', 'style.css'), 'utf8');
  const fonts = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(fonts.sort(), ['/fonts/andika-400-latin.woff2', '/fonts/andika-700-latin.woff2']);
  for (const ref of refs) {
    const res = await fetch(new URL(ref, `${base}/`));
    assert.equal(res.status, 200, ref);
  }
  for (const f of fonts) {
    const res = await fetch(new URL(f, `${base}/app/style.css`));
    assert.equal(res.status, 200, f);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
  }
});

test('every import in app/app.js (and what those import) resolves with 200', async () => {
  const seen = new Set();
  const queue = [new URL('/app/app.js', base).href];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetch(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /text\/javascript/, url);
    const src = await res.text();
    for (const spec of importsOf(src)) {
      assert.match(spec, /^\.\.?\//, `${url} imports a bare or absolute specifier: ${spec}`);
      queue.push(new URL(spec, url).href);
    }
  }
  assert.ok(seen.has(new URL('/lib/segment.js', base).href));
  assert.ok(seen.has(new URL('/lib/progress.js', base).href));
  assert.ok(seen.size >= 6, `only ${seen.size} modules reached`);
});

test('app/app.js parses as an ES module', () => {
  const r = spawnSync(process.execPath, ['--check', path.join(REPO, 'app', 'app.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the data the app loads is served, progress starts fresh', async () => {
  for (const p of ['/data/scope-sequence.json', '/data/word-banks.json', '/stories/step-1.json']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, p);
  }
  const res = await fetch(`${base}/api/progress`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).current_step, 1);
});

test('the app never names the Anthropic API or text-to-speech (R5, R8)', async () => {
  const src = await fs.readFile(path.join(REPO, 'app', 'app.js'), 'utf8');
  assert.doesNotMatch(src, /anthropic/i);
  assert.doesNotMatch(src, /speechSynthesis|SpeechSynthesisUtterance/);
  const html = await fs.readFile(path.join(REPO, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<img|<svg|<canvas|<video|<audio/i);
});
