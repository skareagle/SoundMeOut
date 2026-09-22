import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generate, parseStoryJSON, responseText, findDuplicate, makeId, parseArgs,
  formatSummary, readPool, DEFAULT_MODEL,
} from '../scripts/generate.js';
import { buildPrompt, pickFocusWords, stepBankWords } from '../lib/prompt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const banks = JSON.parse(readFileSync(path.join(root, 'data/word-banks.json'), 'utf8'));
const scope = JSON.parse(readFileSync(path.join(root, 'data/scope-sequence.json'), 'utf8'));

// Two step-2 stories that really do pass lib/validate.js.
const STORY_A = {
  title: 'The pig and the fox',
  lines: [
    'Ben the pig sat in hot mud.',
    'A red fox ran up to him.',
    'Bob had a big bun.',
    'His pet pig got up.',
    'It dug a wet pit.',
    'Fun! The fox and Ben had a nap.',
  ],
};
const STORY_B = {
  title: 'Tim and the big bug',
  lines: [
    'Tim ran to get his net.',
    'A big bug sat on a log.',
    'Dad let him dig in the sun.',
    'Up it hid in a tin can.',
    'The bug had a red dot.',
    'Tim did not get it.',
    'To bed, sad but not mad.',
  ],
};
// Same shape, but "through" is a step-9 word: the validator must refuse it.
const POISONED = {
  title: 'The fox ran',
  lines: [
    'Ben the pig sat in hot mud.',
    'A red fox ran through the pit.',
    'Bob had a big bun.',
    'His pet pig got up.',
    'It dug a wet pit.',
    'Fun! The fox and Ben had a nap.',
  ],
};

// A client with canned replies. Each reply is a string (sent verbatim as the
// text block), an object (JSON-stringified), or an Error (thrown).
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(req);
        if (calls.length > replies.length) throw new Error('fake client: out of replies');
        const r = replies[calls.length - 1];
        if (r instanceof Error) throw r;
        const text = typeof r === 'string' ? r : JSON.stringify(r);
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

// Deterministic 0..1 generator, so ids and focus words are reproducible.
function seqRand() {
  let i = 0;
  return () => {
    i = (i * 1103515245 + 12345) % 2147483648;
    i += 7919;
    return (i % 100000) / 100000;
  };
}

function tempRoot(seedPool) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gen-'));
  if (seedPool) {
    mkdirSync(path.join(dir, 'stories'), { recursive: true });
    writeFileSync(path.join(dir, 'stories/step-2.json'), JSON.stringify(seedPool, null, 2));
  }
  return dir;
}

const opts = (extra) => ({
  step: 2, count: 1, banks, scope, rand: seqRand(),
  now: () => '2026-09-20T00:00:00Z', model: 'fake-model', ...extra,
});

const rejects = (dir) => readFileSync(path.join(dir, 'logs/rejects.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

// ------------------------------------------------------------- the pipeline

test('a valid story is accepted and appended to the pool', async () => {
  const dir = tempRoot();
  const client = fakeClient([STORY_B]);
  const s = await generate(opts({ client, root: dir }));

  assert.equal(s.accepted.length, 1);
  assert.equal(s.attempts, 1);
  assert.equal(s.rejects, 0);
  assert.equal(s.gaveUp, 0);

  const story = s.accepted[0];
  assert.match(story.id, /^s2-[0-9a-f]{4}$/);
  assert.equal(story.step, 2);
  assert.equal(story.title, STORY_B.title);
  assert.deepEqual(story.lines, STORY_B.lines);
  assert.equal(story.validated_at, '2026-09-20T00:00:00Z');
  assert.equal(story.generator, 'fake-model');
  assert.ok(story.words_used.includes('bug'), 'words_used comes from the validator');
  assert.equal(new Set(story.words_used).size, story.words_used.length);

  const pool = readPool(dir, 2);
  assert.equal(pool.step, 2);
  assert.equal(pool.stories.length, 1);
  assert.deepEqual(pool.stories[0], story);
  assert.equal(existsSync(path.join(dir, 'logs/rejects.jsonl')), false, 'nothing rejected');

  // The prompt really was the built one.
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, 'fake-model');
  assert.match(client.calls[0].messages[0].content, /phonics step 2/);
});

test('an invalid story is rejected, logged, and retried', async () => {
  const dir = tempRoot();
  const client = fakeClient([POISONED, STORY_B]);
  const s = await generate(opts({ client, root: dir }));

  assert.equal(s.accepted.length, 1);
  assert.equal(s.attempts, 2);
  assert.equal(s.rejects, 1);
  assert.deepEqual(s.rejectedWords, [['through', 1]]);

  const log = rejects(dir);
  assert.equal(log.length, 1);
  assert.equal(log[0].step, 2);
  assert.equal(log[0].attempt, 1);
  assert.equal(log[0].model, 'fake-model');
  assert.ok(log[0].errors.some((e) => e.code === 'word' && e.word === 'through'));
  assert.match(log[0].reason, /through/);
  assert.match(log[0].raw, /through/, 'the raw response is kept');

  assert.equal(readPool(dir, 2).stories.length, 1, 'only the good story is in the pool');
});

test('gives up after --max-attempts and writes no pool', async () => {
  const dir = tempRoot();
  const client = fakeClient([POISONED, POISONED, POISONED]);
  const s = await generate(opts({ client, root: dir, maxAttempts: 3 }));

  assert.equal(s.accepted.length, 0);
  assert.equal(s.attempts, 3);
  assert.equal(s.rejects, 3);
  assert.equal(s.gaveUp, 1);
  assert.deepEqual(s.rejectedWords, [['through', 3]]);
  assert.equal(rejects(dir).length, 3);
  assert.equal(existsSync(path.join(dir, 'stories/step-2.json')), false);
  assert.match(formatSummary(s), /0\/1 accepted in 3 attempt\(s\)[\s\S]*100% reject rate[\s\S]*through \(3\)/);
});

test('R3 failures (too few lines, long line, repetition) are rejected', async () => {
  const dir = tempRoot();
  const short = { title: 'A big pig', lines: ['A big pig sat.', 'It ran.', 'It got up.'] };
  const client = fakeClient([short, STORY_B]);
  const s = await generate(opts({ client, root: dir }));
  assert.equal(s.accepted.length, 1);
  assert.equal(s.rejects, 1);
  const codes = rejects(dir)[0].errors.map((e) => e.code);
  assert.ok(codes.includes('too_few_lines'), codes.join(','));
});

test('a story that duplicates one in the pool is rejected', async () => {
  const seeded = { step: 2, stories: [{ id: 's2-aaaa', step: 2, ...STORY_A, words_used: [], validated_at: 'x', generator: 'x' }] };
  const dir = tempRoot(seeded);
  // A fresh title, but the same lines: caught by the line overlap.
  const client = fakeClient([{ title: 'Ben the pig', lines: STORY_A.lines }, STORY_B]);
  const s = await generate(opts({ client, root: dir }));

  assert.equal(s.accepted.length, 1);
  assert.equal(s.accepted[0].title, STORY_B.title);
  assert.equal(s.rejects, 1);
  const log = rejects(dir);
  assert.equal(log[0].errors[0].code, 'duplicate_lines');
  assert.equal(log[0].errors[0].id, 's2-aaaa');
  assert.equal(readPool(dir, 2).stories.length, 2);
});

test('a story reusing a title already in the pool is rejected', async () => {
  const seeded = { step: 2, stories: [{ id: 's2-aaaa', step: 2, ...STORY_A, words_used: [], validated_at: 'x', generator: 'x' }] };
  const dir = tempRoot(seeded);
  const sameTitle = { title: 'The pig and the fox!', lines: STORY_B.lines };
  const client = fakeClient([sameTitle, STORY_B]);
  const s = await generate(opts({ client, root: dir }));
  assert.equal(s.rejects, 1);
  assert.equal(rejects(dir)[0].errors[0].code, 'duplicate_title');
  assert.equal(s.accepted.length, 1);
});

test('two stories generated in one run are compared against each other', async () => {
  const dir = tempRoot();
  const client = fakeClient([STORY_B, STORY_B, STORY_A]);
  const s = await generate(opts({ client, root: dir, count: 2 }));
  assert.equal(s.accepted.length, 2);
  assert.equal(s.rejects, 1, 'the repeat of the first story is rejected');
  assert.equal(rejects(dir)[0].errors[0].code, 'duplicate_title');
  const ids = readPool(dir, 2).stories.map((x) => x.id);
  assert.equal(new Set(ids).size, 2, 'ids are unique');
});

test('unparsable and failing responses are rejected, not thrown', async () => {
  const dir = tempRoot();
  const client = fakeClient(['sorry, I cannot do that', new Error('network went away'), STORY_B]);
  const s = await generate(opts({ client, root: dir }));
  assert.equal(s.accepted.length, 1);
  assert.equal(s.rejects, 2);
  const log = rejects(dir);
  assert.match(log[0].reason, /no JSON object/);
  assert.equal(log[0].raw, 'sorry, I cannot do that');
  assert.match(log[1].reason, /network went away/);
});

test('a fenced ```json reply is accepted', async () => {
  const dir = tempRoot();
  const fenced = 'Here you go:\n```json\n' + JSON.stringify(STORY_B, null, 2) + '\n```\n';
  const s = await generate(opts({ client: fakeClient([fenced]), root: dir }));
  assert.equal(s.accepted.length, 1);
  assert.equal(s.accepted[0].title, STORY_B.title);
});

test('generate defaults to claude-sonnet-4-6', async () => {
  const dir = tempRoot();
  const client = fakeClient([STORY_B]);
  const s = await generate({ ...opts({ client, root: dir }), model: undefined });
  assert.equal(s.model, DEFAULT_MODEL);
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-4-6');
  assert.equal(client.calls[0].model, 'claude-sonnet-4-6');
  assert.equal(s.accepted[0].generator, 'claude-sonnet-4-6');
});

// ------------------------------------------------------------- units

test('parseStoryJSON tolerates fences and prose, rejects bad shapes', () => {
  assert.deepEqual(parseStoryJSON('{"title":"A pig","lines":["It ran."]}'), { title: 'A pig', lines: ['It ran.'] });
  assert.deepEqual(parseStoryJSON('```json\n{"title":"A pig","lines":["It ran."]}\n```'), { title: 'A pig', lines: ['It ran.'] });
  assert.deepEqual(parseStoryJSON('```\n{"title":"A pig","lines":["It ran."]}\n```'), { title: 'A pig', lines: ['It ran.'] });
  assert.deepEqual(parseStoryJSON('Sure!\n{"title":" A pig ","lines":[" It ran. "]}\nHope that helps.'), { title: 'A pig', lines: ['It ran.'] });
  assert.throws(() => parseStoryJSON('no json here'), /no JSON object/);
  assert.throws(() => parseStoryJSON('{"title":"A pig", }'), /not JSON/);
  assert.throws(() => parseStoryJSON('{"title":"A pig"'), /no JSON object/, 'an unclosed object has no "}"');
  assert.throws(() => parseStoryJSON('{"lines":["It ran."]}'), /"title"/);
  assert.throws(() => parseStoryJSON('{"title":"A pig","lines":[]}'), /"lines"/);
  assert.throws(() => parseStoryJSON('{"title":"A pig","lines":[3]}'), /non-string/);
  assert.throws(() => parseStoryJSON('```json\n[1,2]\n```'), /not an object/);
});

test('responseText joins text blocks and ignores others', () => {
  assert.equal(responseText({ content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'ab');
  assert.equal(responseText('raw'), 'raw');
  assert.equal(responseText(null), '');
});

test('findDuplicate compares titles and lines, ignoring case and punctuation', () => {
  const pool = [{ id: 's2-aaaa', title: 'The pig and the fox', lines: STORY_A.lines }];
  assert.equal(findDuplicate({ title: 'A new one', lines: STORY_B.lines }, pool), null);
  assert.equal(findDuplicate({ title: 'THE PIG AND THE FOX.', lines: STORY_B.lines }, pool).code, 'duplicate_title');
  const half = { title: 'A new one', lines: [...STORY_A.lines.slice(0, 3), ...STORY_B.lines.slice(0, 3)] };
  assert.equal(findDuplicate(half, pool).code, 'duplicate_lines');
  const third = { title: 'A new one', lines: [...STORY_A.lines.slice(0, 2), ...STORY_B.lines.slice(0, 4)] };
  assert.equal(findDuplicate(third, pool), null, 'under half the lines is not a duplicate');
});

test('makeId avoids ids already taken', () => {
  const rand = seqRand();
  const taken = new Set();
  for (let i = 0; i < 50; i++) {
    const id = makeId(3, taken, rand);
    assert.match(id, /^s3-[0-9a-f]{4}$/);
    assert.equal(taken.has(id), false);
    taken.add(id);
  }
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--step', '3']), { step: 3, count: 1, maxAttempts: 5, model: null });
  assert.deepEqual(parseArgs(['--step', '3', '--count', '10', '--max-attempts', '2', '--model', 'x']), { step: 3, count: 10, maxAttempts: 2, model: 'x' });
  assert.throws(() => parseArgs([]), /--step is required/);
  assert.throws(() => parseArgs(['--step', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--steps', '3']), /unknown argument/);
});

// ------------------------------------------------------------- the prompt

test('buildPrompt has the spec\'s shape and only legal words', () => {
  const p = buildPrompt({ step: 2, banks, scope, rand: seqRand() });
  assert.match(p.text, /^You are writing a decodable story for a 6-year-old at phonics step 2 \(all short vowels\)/);
  assert.match(p.text, /You may use ONLY these words:/);
  assert.match(p.text, /Plus these heart words: /);
  assert.match(p.text, /- 6 to 9 sentences, 3 to 7 words each\./);
  assert.match(p.text, /- No word outside the lists above\. Not one\./);
  assert.match(p.text, /Return JSON: \{ "title": string, "lines": string\[\] \}/);

  assert.ok(p.bankWords.includes('pig'));
  assert.ok(p.bankWords.includes('cat'), 'earlier steps are included');
  assert.ok(!p.bankWords.includes('ship'), 'later steps are not');
  assert.deepEqual(p.bankWords, [...p.bankWords].sort(), 'sorted');
  assert.ok(p.heartWords.includes('the') && p.heartWords.includes('of'));
  assert.ok(!p.heartWords.includes('said'), 'step-3 hearts are not offered at step 2');
  assert.equal(p.bankWords.some((w) => p.heartWords.includes(w)), false, 'no word is in both lists');
});

test('buildPrompt names 8-12 focus words from this step\'s own bank', () => {
  const own = new Set(stepBankWords(2, banks));
  for (let i = 0; i < 5; i++) {
    const p = buildPrompt({ step: 2, banks, scope, rand: Math.random });
    assert.ok(p.focus.length >= 8 && p.focus.length <= 12, `got ${p.focus.length}`);
    assert.equal(new Set(p.focus).size, p.focus.length, 'no repeats');
    for (const w of p.focus) assert.ok(own.has(w), `${w} is not a step-2 word`);
    assert.ok(p.text.includes(p.focus.join(' ')));
  }
});

test('buildPrompt is deterministic given rand, and focus words can be supplied', () => {
  const a = buildPrompt({ step: 3, banks, scope, rand: seqRand() });
  const b = buildPrompt({ step: 3, banks, scope, rand: seqRand() });
  assert.equal(a.text, b.text);
  const c = buildPrompt({ step: 3, banks, scope, focus: ['ship', 'fish'] });
  assert.deepEqual(c.focus, ['ship', 'fish']);
  assert.match(c.text, /Feature several of these words from this step: ship fish/);
});

test('pickFocusWords never repeats and stops at the pool size', () => {
  const words = ['a', 'b', 'c'];
  const got = pickFocusWords(words, seqRand(), 10);
  assert.equal(got.length, 3);
  assert.deepEqual([...got].sort(), words);
});

// ------------------------------------------------------------- the CLI

// Skipped if a .env with a real key exists — the CLI would then get past the
// key check and this test must never reach the network.
test('the CLI refuses to run without ANTHROPIC_API_KEY', { skip: existsSync(path.join(root, '.env')) }, () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  let out;
  try {
    execFileSync(process.execPath, ['scripts/generate.js', '--step', '2', '--count', '1'], {
      cwd: root, env, encoding: 'utf8', stdio: 'pipe',
    });
    assert.fail('should have exited non-zero');
  } catch (e) {
    out = e;
  }
  assert.equal(out.status, 2);
  assert.match(out.stderr, /ANTHROPIC_API_KEY is not set/);
  assert.equal(out.stdout, '');
});

test('the CLI rejects bad arguments before anything else', () => {
  try {
    execFileSync(process.execPath, ['scripts/generate.js', '--step', 'x'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('should have exited non-zero');
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(e.stderr, /--step needs a positive integer/);
  }
});
