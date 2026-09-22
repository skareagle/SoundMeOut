// npm run generate -- --step N --count K [--max-attempts 5] [--model ID]
//
// Tops up stories/step-N.json by asking the Anthropic API for stories built
// from the step's cumulative word bank, validating every one with
// lib/validate.js, and appending only the ones that pass (spec §3). The
// reading app never calls the API — only this script does (R8).
//
// The key comes from the environment (ANTHROPIC_API_KEY, optionally via a
// git-ignored .env). Model from GEN_MODEL, default claude-sonnet-4-6.
//
// The client is injected, so tests drive the whole pipeline with a fake:
//   generate({ client, step, count, root, banks, scope, ... }) -> summary
// A "client" is anything with client.messages.create({model, max_tokens,
// messages}) resolving to { content: [{ type: 'text', text }] }.
//
// Every rejected attempt is appended to logs/rejects.jsonl — that log is the
// signal for which words the model keeps reaching for.
import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { allowedWords } from '../lib/bank.js';
import { validateStory, formatError, tokenize } from '../lib/validate.js';
import { buildPrompt } from '../lib/prompt.js';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_MAX_ATTEMPTS = 5;
export const MAX_TOKENS = 2000;
// A candidate sharing this fraction of its lines with a pool story is a
// near-duplicate and is rejected.
export const DUPLICATE_LINE_RATIO = 0.5;

// ---------------------------------------------------------------- parsing

// The text of a model response ({ content: [...] } or a plain string).
export function responseText(message) {
  if (typeof message === 'string') return message;
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

// Parse { "title": string, "lines": string[] } out of the model's reply.
// Tolerates a ```json fence and surrounding prose. Throws on anything else.
export function parseStoryJSON(text) {
  const src = String(text ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(src);
  let body = fenced ? fenced[1] : src;
  if (!fenced) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in response');
    body = body.slice(start, end + 1);
  }
  let obj;
  try {
    obj = JSON.parse(body.trim());
  } catch (e) {
    throw new Error(`response is not JSON: ${e.message}`);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('response JSON is not an object');
  if (typeof obj.title !== 'string' || !obj.title.trim()) throw new Error('response has no "title" string');
  if (!Array.isArray(obj.lines) || obj.lines.length === 0) throw new Error('response has no "lines" array');
  if (!obj.lines.every((l) => typeof l === 'string')) throw new Error('"lines" contains a non-string');
  return { title: obj.title.trim(), lines: obj.lines.map((l) => l.trim()) };
}

// ---------------------------------------------------------------- pool file

function poolPath(root, step) {
  return path.join(root, 'stories', `step-${step}.json`);
}

export function readPool(root, step) {
  const file = poolPath(root, step);
  if (!existsSync(file)) return { step, stories: [] };
  const pool = JSON.parse(readFileSync(file, 'utf8'));
  if (!pool || !Array.isArray(pool.stories)) throw new Error(`${file}: no "stories" array`);
  if (pool.step !== step) throw new Error(`${file}: pool step is ${JSON.stringify(pool.step)}`);
  return pool;
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function writePool(root, step, pool) {
  writeAtomic(poolPath(root, step), `${JSON.stringify(pool, null, 2)}\n`);
}

// ---------------------------------------------------------------- duplicates

const lineKey = (line) => tokenize(line).join(' ');
const titleKey = (title) => tokenize(title).join(' ');

// null if the candidate is new, else { code, id } naming the pool story it
// duplicates: the same title, or >= 50% of its lines shared.
export function findDuplicate(candidate, stories) {
  const myTitle = titleKey(candidate.title);
  const myLines = candidate.lines.map(lineKey).filter(Boolean);
  for (const other of stories || []) {
    if (!other || !Array.isArray(other.lines)) continue;
    if (myTitle && titleKey(other.title || '') === myTitle) {
      return { code: 'duplicate_title', id: other.id };
    }
    const theirs = new Set(other.lines.map(lineKey));
    if (myLines.length === 0) continue;
    const shared = myLines.filter((l) => theirs.has(l)).length;
    if (shared / myLines.length >= DUPLICATE_LINE_RATIO) {
      return { code: 'duplicate_lines', id: other.id, shared, of: myLines.length };
    }
  }
  return null;
}

// ---------------------------------------------------------------- ids

export function makeId(step, taken, rand = Math.random) {
  for (let i = 0; i < 10000; i++) {
    const id = `s${step}-${Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`cannot find a free id for step ${step}`);
}

// ---------------------------------------------------------------- generate

function logReject(root, record) {
  const file = path.join(root, 'logs', 'rejects.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

// Ask for `count` stories at `step`, up to `maxAttempts` model calls each.
// Returns { step, model, requested, accepted: [story], attempts, rejects,
//           gaveUp, rejectedWords: [[word, n], ...] }.
export async function generate({
  client,
  step,
  count = 1,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  root,
  banks,
  scope,
  model = DEFAULT_MODEL,
  rand = Math.random,
  now = () => new Date().toISOString(),
  log = () => {},
}) {
  const pool = readPool(root, step);
  const allowed = allowedWords(step, banks, scope);
  const taken = new Set(pool.stories.map((s) => s && s.id).filter(Boolean));
  const accepted = [];
  const rejectedWords = new Map();
  let attempts = 0;
  let rejects = 0;
  let gaveUp = 0;

  for (let i = 0; i < count; i++) {
    let got = null;
    for (let attempt = 1; attempt <= maxAttempts && !got; attempt++) {
      attempts++;
      const prompt = buildPrompt({ step, banks, scope, rand });
      let raw = '';
      let problem = null;
      let errors = [];
      let candidate = null;
      try {
        const message = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt.text }],
        });
        raw = responseText(message);
        candidate = parseStoryJSON(raw);
      } catch (e) {
        problem = e.message;
      }

      if (candidate) {
        const story = {
          id: makeId(step, taken, rand),
          step,
          title: candidate.title,
          lines: candidate.lines,
          words_used: [],
          validated_at: now(),
          generator: model,
        };
        const result = validateStory(story, { step, banks, scope, allowed });
        if (!result.ok) {
          errors = result.errors;
          problem = errors.map(formatError).join('; ');
          for (const e of errors) {
            if (e.code === 'word') rejectedWords.set(e.word, (rejectedWords.get(e.word) || 0) + 1);
          }
        } else {
          const dup = findDuplicate(story, [...pool.stories, ...accepted]);
          if (dup) {
            errors = [dup];
            problem = dup.code === 'duplicate_title'
              ? `same title as ${dup.id}`
              : `${dup.shared}/${dup.of} lines shared with ${dup.id}`;
          } else {
            story.words_used = result.words;
            taken.add(story.id);
            accepted.push(story);
            pool.stories.push(story);
            writePool(root, step, pool);
            got = story;
            log(`step ${step}: accepted ${story.id} "${story.title}" (attempt ${attempt})`);
          }
        }
      }

      if (!got) {
        rejects++;
        logReject(root, {
          at: now(), step, story: i + 1, attempt, model, reason: problem, errors, raw,
        });
        log(`step ${step}: rejected (story ${i + 1}, attempt ${attempt}): ${problem}`);
      }
    }
    if (!got) gaveUp++;
  }

  return {
    step,
    model,
    requested: count,
    accepted,
    attempts,
    rejects,
    gaveUp,
    rejectedWords: [...rejectedWords.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

export function formatSummary(s) {
  const rate = s.attempts ? Math.round((s.rejects / s.attempts) * 100) : 0;
  const out = [
    `generate: step ${s.step}: ${s.accepted.length}/${s.requested} accepted in ${s.attempts} attempt(s)`,
    `generate: ${s.rejects} rejected (${rate}% reject rate)${s.gaveUp ? `, gave up on ${s.gaveUp}` : ''}`,
  ];
  if (s.rejectedWords.length) {
    const top = s.rejectedWords.slice(0, 10).map(([w, n]) => `${w} (${n})`).join(', ');
    out.push(`generate: top rejected words: ${top}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

export function parseArgs(argv) {
  const out = { step: null, count: 1, maxAttempts: DEFAULT_MAX_ATTEMPTS, model: null };
  const int = (name, v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a positive integer, got ${JSON.stringify(v)}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--step': out.step = int('--step', argv[++i]); break;
      case '--count': out.count = int('--count', argv[++i]); break;
      case '--max-attempts': out.maxAttempts = int('--max-attempts', argv[++i]); break;
      case '--model': {
        const v = argv[++i];
        if (!v) throw new Error('--model needs a value');
        out.model = v;
        break;
      }
      default: throw new Error(`unknown argument ${JSON.stringify(argv[i])}`);
    }
  }
  if (out.step === null) throw new Error('--step is required');
  return out;
}

const USAGE = 'usage: npm run generate -- --step N --count K [--max-attempts 5] [--model ID]';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`generate: ${e.message}\n${USAGE}`);
    process.exit(2);
  }

  const envFile = path.join(root, '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'generate: ANTHROPIC_API_KEY is not set.\n'
      + `  Put it in ${envFile} as ANTHROPIC_API_KEY=sk-ant-... or export it in your shell.\n`
      + '  Nothing was generated; the reading app itself never needs a key.',
    );
    process.exit(2);
  }

  let banks, scope;
  try {
    banks = JSON.parse(readFileSync(path.join(root, 'data/word-banks.json'), 'utf8'));
    scope = JSON.parse(readFileSync(path.join(root, 'data/scope-sequence.json'), 'utf8'));
  } catch (e) {
    console.error(`generate: cannot read data files: ${e.message}`);
    process.exit(2);
  }
  if (!scope.some((s) => s.id === args.step)) {
    console.error(`generate: step ${args.step} is not in the scope sequence`);
    process.exit(2);
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const model = args.model || process.env.GEN_MODEL || DEFAULT_MODEL;

  let summary;
  try {
    summary = await generate({
      client, step: args.step, count: args.count, maxAttempts: args.maxAttempts,
      root, banks, scope, model, log: (m) => console.log(m),
    });
  } catch (e) {
    console.error(`generate: ${e.message}`);
    process.exit(1);
  }
  console.log(formatSummary(summary));
  if (summary.accepted.length === 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
