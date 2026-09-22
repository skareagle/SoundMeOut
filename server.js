// Decodable Reader server: static files + /api/progress. node:http only.
//
//   HOST (default 0.0.0.0) and PORT (default 8080) pick the listen address.
//   Only index.html and the app/, lib/, data/, stories/, fonts/ trees are
//   served; everything else (scripts/, plans/, node_modules/, .env, ...) is 404.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { normalizeProgress } from './lib/progress.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 256 * 1024;
const SERVED_DIRS = new Set(['app', 'lib', 'data', 'stories', 'fonts']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, type = 'text/plain; charset=utf-8', head = false) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(head ? undefined : buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

// Map a URL pathname to an absolute file path inside root, or null if it is
// not something we serve.
function resolveStatic(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded === '/' || decoded === '/index.html') {
    return path.join(root, 'index.html');
  }
  const parts = decoded.split('/').filter(Boolean);
  // No '.', '..' or dotfile segments anywhere.
  if (parts.length < 2 || parts.some((p) => p.startsWith('.'))) return null;
  if (!SERVED_DIRS.has(parts[0])) return null;
  // progress.json is only reachable through /api/progress.
  if (parts[0] === 'data' && parts.length === 2 && parts[1].startsWith('progress.json')) {
    return null;
  }
  const full = path.resolve(root, ...parts);
  const top = path.resolve(root, parts[0]) + path.sep;
  if (!full.startsWith(top)) return null;
  if (!TYPES[path.extname(full).toLowerCase()]) return null;
  return full;
}

async function serveStatic(root, req, res, pathname) {
  const file = resolveStatic(root, pathname);
  if (!file) return send(res, 404, 'Not found\n');
  let data;
  try {
    // Refuse symlinks that escape the served tree.
    const real = await fs.realpath(file);
    const realRoot = await fs.realpath(root);
    if (real !== path.join(realRoot, path.relative(root, file))) {
      return send(res, 404, 'Not found\n');
    }
    const st = await fs.stat(real);
    if (!st.isFile()) return send(res, 404, 'Not found\n');
    data = await fs.readFile(real);
  } catch {
    return send(res, 404, 'Not found\n');
  }
  send(res, 200, data, TYPES[path.extname(file).toLowerCase()], req.method === 'HEAD');
}

async function readProgress(dataDir) {
  try {
    const text = await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8');
    return normalizeProgress(text);
  } catch {
    return normalizeProgress(undefined);
  }
}

async function writeProgress(dataDir, progress) {
  await fs.mkdir(dataDir, { recursive: true });
  const target = path.join(dataDir, 'progress.json');
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(progress, null, 2) + '\n');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) {
      reject(new HttpError(413, 'Body too large'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        reject(new HttpError(413, 'Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

async function handleProgress(dataDir, req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, await readProgress(dataDir));
  }
  if (req.method === 'PUT') {
    const text = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'Body must be JSON');
    }
    const progress = normalizeProgress(parsed);
    await writeProgress(dataDir, progress);
    return sendJson(res, 200, progress);
  }
  res.setHeader('Allow', 'GET, PUT');
  return send(res, 405, 'Method not allowed\n');
}

export function createServer({ root = HERE, dataDir = path.join(root, 'data') } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api/progress') {
        return await handleProgress(dataDir, req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return send(res, 405, 'Method not allowed\n');
      }
      return await serveStatic(root, req, res, pathname);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) {
        if (status === 413) res.setHeader('Connection', 'close');
        send(res, status, (err instanceof HttpError ? err.message : 'Server error') + '\n');
      }
    }
  });
}

function lanUrls(port) {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}/`);
    }
  }
  return urls;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT) || 8080;
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Decodable Reader listening on ${host}:${port}`);
    const urls = host === '0.0.0.0' ? lanUrls(port) : [`http://${host}:${port}/`];
    for (const u of urls) console.log(`  ${u}`);
  });
}
