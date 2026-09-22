// npm run validate [-- --step N] — validates every story in stories/step-*.json
// (or just stories/step-N.json) with lib/validate.js against the real banks
// and scope. Prints each failure; exits 1 if any story fails, 2 on bad
// arguments or unreadable data, 0 otherwise (including when no pools exist).
//
// Pool file shape: { "step": N, "stories": [story, ...] }. A missing pool file
// is skipped. A pool whose own `step` disagrees with its file name, or that
// isn't the right shape, counts as a failure.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { allowedWords } from '../lib/bank.js';
import { validateStory, formatError } from '../lib/validate.js';

// Validate the pools under `root`. `steps` = list of step numbers, or null for
// every stories/step-*.json present. Returns
// { pools: [{ step, file, total, failures: [{ id, index, errors }], problem? }], skipped: [step] }
export function validatePools({ root, steps = null, banks, scope }) {
  const dir = path.join(root, 'stories');
  if (steps === null) {
    steps = existsSync(dir)
      ? readdirSync(dir)
        .map((f) => /^step-([1-9][0-9]*)\.json$/.exec(f))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b)
      : [];
  }
  const pools = [];
  const skipped = [];
  for (const step of steps) {
    const file = path.join(dir, `step-${step}.json`);
    if (!existsSync(file)) { skipped.push(step); continue; }
    const result = { step, file, total: 0, failures: [] };
    pools.push(result);
    let pool;
    try {
      pool = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      result.problem = `cannot read: ${e.message}`;
      continue;
    }
    if (!pool || !Array.isArray(pool.stories)) { result.problem = 'no "stories" array'; continue; }
    if (pool.step !== step) { result.problem = `pool step is ${JSON.stringify(pool.step)}, file is step-${step}`; }
    const allowed = allowedWords(step, banks, scope);
    result.total = pool.stories.length;
    pool.stories.forEach((story, index) => {
      const r = validateStory(story, { step, banks, scope, allowed });
      if (!r.ok) result.failures.push({ id: story && story.id, index, errors: r.errors });
    });
  }
  return { pools, skipped };
}

function parseArgs(argv) {
  const out = { steps: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--step') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--step needs a positive integer, got ${JSON.stringify(argv[i])}`);
      out.steps = [n];
    } else {
      throw new Error(`unknown argument ${JSON.stringify(argv[i])}`);
    }
  }
  return out;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let args, banks, scope;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`validate: ${e.message}\nusage: npm run validate [-- --step N]`);
    process.exit(2);
  }
  try {
    banks = JSON.parse(readFileSync(path.join(root, 'data/word-banks.json'), 'utf8'));
    scope = JSON.parse(readFileSync(path.join(root, 'data/scope-sequence.json'), 'utf8'));
  } catch (e) {
    console.error(`validate: cannot read data files: ${e.message}`);
    process.exit(2);
  }

  const { pools, skipped } = validatePools({ root, steps: args.steps, banks, scope });
  for (const s of skipped) console.log(`validate: step ${s}: no stories/step-${s}.json, skipped`);
  if (pools.length === 0) {
    console.log('validate: no story pools found, nothing to check');
    return;
  }
  let bad = 0;
  for (const p of pools) {
    if (p.problem) { bad++; console.error(`step ${p.step}: ${p.problem}`); }
    for (const f of p.failures) {
      bad++;
      console.error(`step ${p.step} story ${f.id ?? `#${f.index}`}:`);
      for (const e of f.errors) console.error(`  ${formatError(e)}`);
    }
    console.log(`validate: step ${p.step}: ${p.total - p.failures.length}/${p.total} stories pass`);
  }
  if (bad) {
    console.error(`validate: ${bad} failure(s)`);
    process.exit(1);
  }
  console.log('validate: ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
