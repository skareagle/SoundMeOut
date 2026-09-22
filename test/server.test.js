import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';
import { defaultProgress } from '../lib/progress.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let root, dataDir, server, base, port;

// Raw request so '..' and odd paths reach the server un-normalised.
function raw(method, rawPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dr-root-'));
  dataDir = path.join(root, 'data');
  await fs.mkdir(dataDir);
  await fs.mkdir(path.join(root, 'app'));
  await fs.mkdir(path.join(root, 'lib'));
  await fs.mkdir(path.join(root, 'stories'));
  await fs.mkdir(path.join(root, 'fonts'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, 'plans'));
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  await fs.writeFile(path.join(root, 'app', 'app.js'), 'export const x = 1;');
  await fs.writeFile(path.join(root, 'app', 'style.css'), 'body{}');
  await fs.writeFile(path.join(root, 'lib', 'bank.js'), 'export {};');
  await fs.writeFile(path.join(root, 'data', 'scope-sequence.json'), '[]');
  await fs.writeFile(path.join(root, 'stories', 'step-1.json'), '{"step":1,"stories":[]}');
  await fs.copyFile(
    path.join(REPO, 'fonts', 'andika-400-latin.woff2'),
    path.join(root, 'fonts', 'andika-400-latin.woff2'),
  );
  await fs.writeFile(path.join(root, '.env'), 'ANTHROPIC_API_KEY=secret');
  await fs.writeFile(path.join(root, 'scripts', 'generate.js'), '// secret');
  await fs.writeFile(path.join(root, 'plans', 'x.md'), '# plan');
  await fs.writeFile(path.join(root, 'node_modules', 'x.js'), '');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(root, 'server.js'), '// src');
  await fs.symlink(path.join(root, '.env'), path.join(root, 'app', 'leak.js'));

  server = createServer({ root, dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(root, { recursive: true, force: true });
});

test('serves allowed files with correct content types', async () => {
  const cases = [
    ['/', 'text/html; charset=utf-8'],
    ['/index.html', 'text/html; charset=utf-8'],
    ['/app/app.js', 'text/javascript; charset=utf-8'],
    ['/app/style.css', 'text/css; charset=utf-8'],
    ['/lib/bank.js', 'text/javascript; charset=utf-8'],
    ['/data/scope-sequence.json', 'application/json; charset=utf-8'],
    ['/stories/step-1.json', 'application/json; charset=utf-8'],
    ['/fonts/andika-400-latin.woff2', 'font/woff2'],
  ];
  for (const [p, type] of cases) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('content-type'), type, p);
    await res.arrayBuffer();
  }
});

test('font bytes are served unchanged', async () => {
  const res = await fetch(base + '/fonts/andika-400-latin.woff2');
  const got = Buffer.from(await res.arrayBuffer());
  const want = await fs.readFile(path.join(REPO, 'fonts', 'andika-400-latin.woff2'));
  assert.ok(got.equals(want));
});

test('refuses secrets, source outside the served trees, and traversal', async () => {
  const paths = [
    '/.env',
    '/scripts/generate.js',
    '/plans/x.md',
    '/node_modules/x.js',
    '/package.json',
    '/server.js',
    '/../etc/passwd',
    '/../../etc/passwd',
    '/app/../.env',
    '/app/../scripts/generate.js',
    '/app/%2e%2e/.env',
    '/app/%2e%2e/%2e%2e/etc/passwd',
    '/fonts/..%2f..%2fetc/passwd',
    '/app/..%5c.env',
    '/app/.env',
    '/app/leak.js',
    '/data/progress.json',
    '/app/',
    '/app',
    '/nope.html',
    '/%00',
    '/%E0%A4%A',
  ];
  for (const p of paths) {
    const res = await raw('GET', p);
    assert.equal(res.status, 404, p);
    assert.ok(!res.body.toString().includes('secret'), p);
  }
});

test('static files are GET/HEAD only', async () => {
  const head = await raw('HEAD', '/app/app.js');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  for (const m of ['PUT', 'POST', 'DELETE']) {
    const res = await raw(m, '/data/scope-sequence.json', '[]');
    assert.equal(res.status, 405, m);
  }
  assert.equal(await fs.readFile(path.join(root, 'data', 'scope-sequence.json'), 'utf8'), '[]');
});

test('GET /api/progress with no file returns the default', async () => {
  await fs.rm(path.join(dataDir, 'progress.json'), { force: true });
  const res = await fetch(base + '/api/progress');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), defaultProgress());
});

test('PUT then GET round-trips progress', async () => {
  const progress = {
    ...defaultProgress(),
    current_step: 2,
    reads: { 's2-91bc': 3 },
    stumbles: { mud: 4 },
    seen: ['s2-91bc'],
  };
  const put = await fetch(base + '/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
  });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), progress);

  const got = await (await fetch(base + '/api/progress')).json();
  assert.deepEqual(got, progress);

  const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8'));
  assert.deepEqual(onDisk, progress);
  const leftovers = (await fs.readdir(dataDir)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('PUT normalizes what it stores', async () => {
  const res = await fetch(base + '/api/progress', {
    method: 'PUT',
    body: JSON.stringify({ current_step: 'x', seen: ['a', 3], junk: true }),
  });
  assert.equal(res.status, 200);
  const want = { ...defaultProgress(), seen: ['a'] };
  assert.deepEqual(await res.json(), want);
  assert.deepEqual(await (await fetch(base + '/api/progress')).json(), want);
});

test('PUT rejects invalid JSON without touching the file', async () => {
  const before = await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8');
  const res = await fetch(base + '/api/progress', { method: 'PUT', body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8'), before);
});

test('PUT caps the body at 256 KB', async () => {
  const before = await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8');
  const big = JSON.stringify({ seen: ['x'.repeat(300 * 1024)] });
  const res = await raw('PUT', '/api/progress', big);
  assert.equal(res.status, 413);
  assert.equal(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8'), before);
});

test('corrupt progress.json yields the default on GET', async () => {
  for (const garbage of ['{{{not json', '', '[1,2,3]', 'null', '\u0000\u0001']) {
    await fs.writeFile(path.join(dataDir, 'progress.json'), garbage);
    const res = await fetch(base + '/api/progress');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), defaultProgress(), JSON.stringify(garbage));
  }
});

test('other methods on /api/progress are refused', async () => {
  const res = await raw('POST', '/api/progress', '{}');
  assert.equal(res.status, 405);
});

test('PUT creates the data dir if it is missing', async () => {
  const fresh = path.join(root, 'fresh-data');
  const s = createServer({ root, dataDir: fresh });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/progress`, {
      method: 'PUT',
      body: JSON.stringify({ current_step: 4 }),
    });
    assert.equal(res.status, 200);
    const onDisk = JSON.parse(await fs.readFile(path.join(fresh, 'progress.json'), 'utf8'));
    assert.equal(onDisk.current_step, 4);
  } finally {
    await new Promise((r) => s.close(r));
  }
});
