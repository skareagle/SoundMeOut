# decodable-reader — build the Decodable Reader and serve it on the LAN

Status: done

## Goal

Build the app described in `docs/build-spec.html` (the "Decodable Reader — build
spec"; read it in full before starting any step — it is the contract). The UI
reference implementation is extracted verbatim to `docs/prototype.html`.

On top of the spec, the user asked: **serve it over the local network so anyone
on the home wifi can open it.** That changes three things relative to the spec:

1. A small Node server (`server.js`) serves the app, bound to `0.0.0.0`
   (port `PORT`, default `8080`). The machine's LAN address is
   `<LAN IP>`, so the app is at `http://<LAN IP>:8080/`.
2. `data/progress.json` lives **on the server** and is read/written via
   `GET/PUT /api/progress`, so a phone, a tablet and a laptop all see the same
   child's progress. (One child, so last-write-wins is acceptable.)
3. "Works with the network disabled" (acceptance 3) now means: **no internet**
   needed. Everything — including the Andika font — is served from this
   machine. No CDN, no Google Fonts link at runtime.

## Rules this task must hold (from the spec — non-negotiable)

- **R1 Decodability.** Every word in a displayed story is in the union of the
  word banks for steps 1..current, or in the cumulative heart words for steps
  1..current. Generate-then-verify; a failing story is never displayed.
  Validator is dumb and strict: strip punctuation, lowercase, exact set
  membership. No stemming. If validator and generator disagree, validator wins.
- **R2 Validate on read as well as write.** The app validates every story when
  it loads a pool; a poisoned story (e.g. `through` in step 2) is refused at
  load time.
- **R3 Also reject** stories with < 5 lines, any line > 9 words, duplicate
  lines, or distinct-word count < 60% of total word count.
- **R4 The reading surface has no images, mascots or decorative art.**
- **R5 Do not add:** "what happens next" / picture-cue prompts; automatic
  whole-word text-to-speech; timers, scores, streaks, confetti; automatic
  difficulty adjustment; automatic step promotion.
- **R6 Keep from the prototype:** tap-a-word sound breakdown (graphemes
  coloured by kind with separators, `/sh/ /i/ /p/ → ship`, silent e greyed with
  explanation); heart words purple and not segmented ("just tell him the
  word"); warm-up strip; "Colour the sounds" toggle off by default; "One line
  at a time" with arrow keys; three repeated-reading dots; print view with
  controls hidden and large type; Andika with its fallback stack.
- **R7 Word bank entries are pre-segmented** (`{"w","g":[[text,kind],...],"step"}`;
  kinds `c v d s t`), and steps 6+ entries carry `sounds` where a grapheme is
  ambiguous. The runtime splitter uses the bank's segmentation; the
  Appendix A splitter is a fallback only.
- **R8 The app never calls the Anthropic API.** Only `scripts/generate.js`
  does, key from env (`ANTHROPIC_API_KEY`, optionally loaded from a
  git-ignored `.env`). Model from `GEN_MODEL`, default `claude-sonnet-4-6`
  as the spec says.
- **R9 progress.json** survives a browser restart (it's on the server); a
  missing or corrupt file degrades to a fresh start, never a crash.

## Architecture (fixed — steps implement this, they don't redesign it)

```
package.json          "type": "module"; scripts: start, test, generate, validate, check-bank
server.js             node:http only, no framework. Static files + /api/progress.
lib/                  ES modules shared by Node scripts AND the browser (no Node-only imports)
  bank.js             allowedWords(step, banks, scope), heartWords(step, scope), entryFor(word)
  validate.js         validateStory(story, ctx) -> { ok, errors: [{code, word?, line?}] }
  segment.js          segment(word, bankIndex) -> [{t,k}]; falls back to Appendix A splitter
  rotation.js         pickStory(pool, progress) per the rotation rules
  progress.js         defaultProgress(), normalizeProgress(anything) -> valid progress
data/
  scope-sequence.json steps 1–10
  word-banks.json     { "1": [entries], ..., "10": [entries] }
  progress.json       created at runtime; git-ignored
stories/step-N.json   { "step": N, "stories": [story, ...] }
logs/rejects.jsonl    one line per rejected generation; git-ignored
scripts/
  generate.js         npm run generate -- --step 3 --count 10
  validate.js         npm run validate [-- --step N]; exits non-zero on any failure
  check-bank.js       npm run check-bank; verifies bank segmentation
fonts/                Andika woff2 (400, 700, latin subset) + OFL.txt
app/app.js app/style.css
index.html
test/*.test.js        node --test
```

Test command: `npm test` (runs `node --test "test/*.test.js"`). Narrow with
`node --test test/<file>.test.js`.

## Steps

Each step: edit only the files it names, then tick it here, fill in its
**Done** notes, and report test output.

### [x] 1. Scaffold, server, font
Files: `package.json`, `.gitignore`, `server.js`, `fonts/*`, `lib/progress.js`,
`test/server.test.js`, `test/progress.test.js`, `README.md` (stub).
- `package.json` with `"type":"module"`, scripts above, dependency
  `@anthropic-ai/sdk` (install it). No other runtime deps. Node ≥ 22.
- `.gitignore`: `node_modules/`, `data/progress.json`, `logs/`, `.env`.
- `server.js`: serves the repo's `index.html`, `app/`, `lib/`, `data/`
  (GET only), `stories/`, `fonts/` with correct content types; refuses path
  traversal and anything else (no serving `.env`, `scripts/`, `node_modules/`,
  `plans/`). `GET /api/progress` returns `normalizeProgress(file contents)`
  (missing/corrupt → default). `PUT /api/progress` accepts JSON, normalizes it,
  writes atomically (tmp file + rename), caps body at 256 KB. Binds
  `HOST` (default `0.0.0.0`) and `PORT` (default `8080`); on start, logs every
  non-internal IPv4 URL. Export a `createServer({root, dataDir})` so tests can
  run it on an ephemeral port against a temp data dir.
- `lib/progress.js`: `defaultProgress()` = `{current_step:1, reads:{},
  stumbles:{}, seen:[], step_history:[], sessions:[], current_story:{},
  last_story:{}}` (the spec's shape plus `sessions`, and per-step
  `current_story`/`last_story` maps keyed by step). `normalizeProgress(x)`
  drops wrong-typed fields back to defaults, never throws.
- Download Andika 400 and 700 latin woff2 from
  `https://fonts.gstatic.com/s/andika/v27/mem_Ya6iyW-LwqgwarYQ.woff2` (400) and
  `https://fonts.gstatic.com/s/andika/v27/mem8Ya6iyW-Lwqg40ZMFVZ0b.woff2` (700)
  into `fonts/`, plus the SIL OFL text as `fonts/OFL.txt`.
Done when: `npm test` passes; `npm start` then `curl http://<LAN IP>:8080/fonts/<file>`
returns 200 and `curl .../.env`, `.../scripts/generate.js`, `.../../etc/passwd`
return 404; PUT then GET of progress round-trips; deleting `data/progress.json`
or writing garbage into it yields the default on GET.

**Done:** Wrote `package.json` (`"type":"module"`, `engines.node >=22`, scripts
start/test/generate/validate/check-bank), ran `npm install @anthropic-ai/sdk`
(^0.127.0; also creates `package-lock.json`, not in the step's file list but a
normal install byproduct). `.gitignore` as specified. `lib/progress.js`:
`defaultProgress()` exactly the shape above; `normalizeProgress(x)` accepts
an object or a JSON string, filters `reads`/`stumbles` to non-negative-integer
values, `seen` to unique strings, `step_history` to `{step:int>=1,
promoted_at:string}`, `sessions` to plain objects, `current_story`/`last_story`
to string values, drops unknown keys, never throws. `server.js`: node:http,
`createServer({root, dataDir})` exported; serves `/` and `/index.html`, and
files under `app/ lib/ data/ stories/ fonts/` whose extension is in a type
table (.html .js .mjs .css .json .woff2 .txt .svg .ico); rejects dot-segments
and dotfiles (after percent-decoding), backslashes, NUL, symlinks (realpath
must equal the lexical path), directories, and `data/progress.json*` (only
reachable via the API). Static is GET/HEAD only (405 otherwise).
`/api/progress`: GET → normalized file or default; PUT → 400 on bad JSON,
413 over 256 KB, else normalize, `mkdir -p dataDir`, write `progress.json.<pid>.<hex>.tmp`
and rename; responds with the stored object. All responses `Cache-Control: no-cache`.
Start-up logs every non-internal IPv4 URL (observed: <LAN IP> and a
tailscale address). Fonts: `fonts/andika-400-latin.woff2` (19208 B),
`fonts/andika-700-latin.woff2` (19472 B) from the given gstatic URLs; `fonts/OFL.txt`
from `github.com/google/fonts/main/ofl/andika/OFL.txt`. `README.md` is a stub
pointing at step 8. Tests: `test/progress.test.js` (8) and `test/server.test.js`
(12, temp root + temp dataDir on port 0, including a symlink-to-.env leak case
and 22 traversal/forbidden paths); `npm test` 20/20 pass. Manual: `npm start`
on 8080, curl via <LAN IP>: both woff2 200 `font/woff2`; `.env` and
`scripts/generate.js` (dummy files created for the check, then deleted),
`../etc/passwd` (with and without `--path-as-is`), `plans/INDEX.md`,
`node_modules/...` all 404; PUT then GET round-tripped (unknown key dropped);
after `rm data/progress.json` and after writing garbage, GET returned the default;
bad JSON 400; 300 KB body 413. Server stopped; `data/` removed afterwards.
Deliberately left: `/` 404s until step 7 adds `index.html`; no `reads` upper
bound (0..3) is enforced in normalize — step 6's `setReads` can clamp.
**Changes a later step:** `node --test test/` does not work on Node 22.22
(it tries to load `test` as a module and fails), so the `test` script is
`node --test "test/*.test.js"` (Node expands the quoted glob). Narrowing by
file (`node --test test/x.test.js`) works as the plan says.


### [x] 2. Scope sequence and word banks
Files: `data/scope-sequence.json`, `data/word-banks.json`, `lib/bank.js`,
`scripts/check-bank.js`, `test/bank.test.js`.
- Scope sequence for steps 1–10 in the spec's shape (`id, tag, name, teaches,
  graphemes_added, structures_added, heart_words, word_bank` → `word_bank` is
  NOT duplicated here; banks live in `word-banks.json`). Heart words are
  **cumulative** at runtime (`heartWords(step)` = union of 1..step). Start
  from the prototype's heart lists; `is`, `has`, `his`, `as` are heart words
  at step 1 because the splitter reports their final `s` as `/s/` not `/z/`.
  Words stories need early but that decode only later (e.g. `and`, a step-4
  blend) are heart words from the step they're first needed, and are then
  **not** added to a later bank (a word is either a heart word or a bank word,
  never both).
- Banks: steps 1–5 substantial (aim ≥ 60 entries each where the phonics allow;
  step 1 will be smaller) — concrete, meaningful to a six-year-old, including
  the function words stories need (`in`, `on`, `it`, `up`, `not`, `can`, `got`,
  `did`…) at the step they become decodable, and decodable proper names
  (`Sam`, `Pam`, `Jack`, `Jake`…) with `"name": true`. Include inflected forms
  explicitly where legal (`digs`, `jumps`, `grabs` — final `s` after an unvoiced
  consonant, from step 4 as consonant-cluster words). Every word used by the
  prototype's five stories must be in a bank or a heart list at its step, or
  be listed in **Found along the way** with the reason it was excluded.
  Steps 6–10: at least 25 entries each, with `sounds` for ambiguous graphemes
  (`ea`, `ow`, `oo`), kind `t` for vowel teams and r-controlled/diphthong pairs.
- `lib/bank.js` (browser-safe): `buildIndex(banks)`, `allowedWords(step,…)`,
  `heartWords(step, scope)`, `entryFor(word, index)`.
- `scripts/check-bank.js`: for every entry, `g` texts join to `w`; every
  grapheme's text is permitted at or before the entry's `step` (derive the
  permitted grapheme set per step from `graphemes_added`, with steps 1–2 single
  letters); kinds are valid; no word appears at two steps; no word is also a
  heart word at or before its step. Exits non-zero with a list on failure.
Done when: `npm run check-bank` exits 0; `node --test test/bank.test.js` passes.

**Done:** `data/scope-sequence.json` holds steps 1–10 in the spec shape (no
`word_bank`). `data/word-banks.json` has 922 entries, one per line:
step 1: 58, step 2: 140, step 3: 138, step 4: 267, step 5: 139, step 6: 48,
step 7: 36, step 8: 37, step 9: 29, step 10: 30. I built it with a scratch
script (not in the repo) that segments from word lists, and checked every
step 1–5 word by eye. **Heart words, added per step (cumulative at runtime,
37 in all):** 1 `the a is has his as and to`; 2 `i of put go no`;
3 `he she we me be was you said what my do so`; 4 `from they are`;
5 `have give live come some one were there where`; 6–10 none. `and` and `to`
move to step 1 from the prototype's step 2. Step 1 stories need them and only
have short a to work with, and `and` otherwise decodes only at step 4. `i` is
stored lowercase because the validator lowercases.
**Grapheme conventions:**
- Steps 1–2 add single letters: step 1 is `a` plus 19 consonants (all
  but `q x`, with `y` as a consonant only); step 2 is `e i o u x`.
- Step 3 adds `sh ch th ck wh ng nk qu`, and the doubles `ll ss ff zz` as
  **kind `d`**, the same as `ck` (two letters, one sound). `gg dd nn tt pp bb`
  are not graphemes, so words like `egg add odd` are left out.
- Step 5's `x_e` items permit `e` as kind `s`.
- Steps 6–9 are kind `t`, and the step-10 suffix units `ed es le` are kind
  `d`. `-ing` is written as `i` + `ng`.
- `lib/bank.js` `GRAPHEME_KIND` lists every multi-letter grapheme. The
  checker rejects any scope grapheme not in that table.
- Permission is checked on the pair `text:kind`, so `y` as a vowel can never
  pass.
- The checker also has **structure rules**: steps 1–3 need exactly one vowel
  grapheme and no two adjacent consonant graphemes (`c`/`d`). So `next`,
  `its`, `cats` and every blend start at step 4.
**-s rule:** Base words ending in `s` = /s/ (`gas bus yes us plus`) are
bank words at their normal step. `is has his as` are hearts. Inflected `-s`
enters at **step 4** (it makes a final cluster) and at step 5 for magic-e
words (`bikes`, `rides`). It follows any voiced or unvoiced consonant
except the sibilants (`sh ch ss x zz` take `-es` at step 10). Where the `s`
says /z/, the entry carries `sounds` with a final `"s:z"` (`digs grabs runs
rides homes`, and `nose rose those chose`). The checker forbids `s:z`
before step 4, and a test recomputes voicing for every step 1–5 `-s` entry.
**Other decisions:**
- The `sounds` format is the spec's: one item per grapheme, `"text"` or
  `"text:sound"`. It is required for `ea ow oo ou ed es`.
- `ow:ou` (cow) is rejected before the step that adds `ou` (step 9). Found
  by a probe: step-9 `cow now down…` were graphemically legal at step 7.
- `u_e` has two sounds (/juː/ in `cute cube mule`, /uː/ in `tune rule flute`).
  I left it without `sounds` because the plan requires `sounds` only at
  steps 6+.
**Excluded as irregular (a test asserts they are in no bank):**
- `-old -ind -ild -ost` words (`kind find wild child cold old gold told most
  post both`)
- `o` + `ll`: `roll toll poll`
- `a` + `ll`/`lk`: `all ball call tall walk talk`
- `w` + `a`: `was wasp want wash wand swan swap watch squash`
- `u` = /ʊ/: `put push pull full bull bush`
- `o` = /ʌ/: `son ton won front`, and `come some one done love glove dove`
- the `-ve` exceptions `have give live`
- soft `c`/`g`: `ice nice face page age huge`
- plus `lose whose whole here these close use read row bow great`, `r` + vowel
  (`bear ear word work war`), and silent-e `house mouse`
Some of these are hearts instead (see above). `put`, `was`, `from` and
`what` are hearts. `full`/`pull`/`push` are neither.
**Tests:** `test/bank.test.js`, 17 tests:
- the real banks pass
- the scope shape
- bank sizes
- every word of the five prototype stories is allowed at its step, and
  every warm-up word is a bank word
- function words sit at the step they decode
- heart words are cumulative
- `allowedWords` excludes later steps
- `entryFor` is case-insensitive
- the exception list above
- the `s:z` voicing rule
- the checker catches each class of error: untaught grapheme, `through`,
  cluster at step 3, silent e at step 4, two syllables at step 2, join
  mismatch, bad kind, duplicate, heart overlap, missing or misaligned
  `sounds`, `s:z` at step 2, `ow:ou` at step 7, a multi-letter grapheme at
  step 2, an unknown scope grapheme
**Results:** `npm run check-bank` exits 0; `node --test test/bank.test.js`
17/17; `npm test` 37/37.
**API:** `lib/bank.js` exports:
- `buildIndex(banks)` → a Map from lowercase word to entry
- `entryFor(word, index)` → the entry, or null (case-insensitive)
- `bankWords(step, banks)`
- `heartWords(step, scope)` (cumulative)
- `allowedWords(step, banks, scope)` = bank words for steps 1..step plus
  heart words for steps 1..step, i.e. the whole set the validator allows
- `permittedGraphemes(step, scope)`
- `graphemeKeys`, `GRAPHEME_KIND`, `AMBIGUOUS`, `KINDS`
`scripts/check-bank.js` exports `checkBank(banks, scope)` → list of errors,
and runs as a CLI only when invoked directly.
**Deliberately left:**
- `-ing` words (`jumping`, `fishing`…) are placed at step 10 on purpose,
  though their graphemes are legal at step 4.
- Two-syllable closed compounds (`sunset picnic catnip bathtub himself
  chipmunk`…) are at step 4.
**Changes later steps:**
- Step 3's validator should call `allowedWords(step, banks, scope)`, which
  already includes the hearts.
- Step 6's `segment` gets `sound` from `entry.sounds[i]`: take the part after
  `:`, and use nothing when there is no `:`.
- Step 5a stories get `and`/`to` at step 1, but no `in on it up` until step 2.


### [x] 3. Validator
Files: `lib/validate.js`, `scripts/validate.js`, `test/validate.test.js`.
- `validateStory(story, {step, banks, scope})` implements R1 and R3 exactly
  as the spec's pseudocode — tokenise on whitespace, strip non-letters except
  internal apostrophes (then reject any word with an apostrophe unless it's in
  the lists), lowercase. Also checks `story.step === step`, `title` words (the
  title is displayed, so it must pass too), and that `lines` is a non-empty
  array of strings. Returns every error, not just the first.
- `scripts/validate.js`: validates every story in `stories/step-*.json`
  (or `--step N`), prints per-failure detail, exits 1 if any fail.
- Tests must include: the poisoned case (`through` in a step-2 story → rejected
  with the word named), a word legal at step 3 used in a step-2 story, a name
  not in the bank, each R3 rule, punctuation stripping (`"Stop!"`, `cat,`),
  and case-insensitivity.
Done when: `node --test test/validate.test.js` passes.

**Done:** `lib/validate.js` (browser-safe, imports only `./bank.js`) exports
`validateStory(story, {step, banks, scope, allowed?})`, `tokenize(line)`,
`normalizeToken(token)`, `formatError(error)` and the constants `MIN_LINES` (5),
`MAX_WORDS_PER_LINE` (9), `MIN_DISTINCT_RATIO` (0.6). The return shape is
documented in the file's header comment: `{ ok, errors, words }`, where `words`
is the distinct lowercase words in first-seen order (what step 4 stores as
`words_used`) and every error is `{code, ...}` with `line` = 0-based index into
`lines` or the string `'title'`. Codes: `not_object`, `step_mismatch`,
`bad_title`, `bad_lines`, `bad_line`, `empty_line`, `bad_token`, `word`,
`too_few_lines`, `line_too_long`, `duplicate_line`, `low_variety`. All errors
are returned, not just the first. The allowed set is `allowedWords(step, banks,
scope)` from `lib/bank.js` (hearts included); `ctx.allowed` may be passed
instead so a pool is validated with one set built once — step 7 should do that.
**Tokenising decisions** (the spec only says "strip punctuation, lowercase"):
split on whitespace; curly apostrophes (`’`) normalise to `'`; letters and
internal apostrophes are kept, everything outside the first and last letter is
stripped (`"Stop!"` → `stop`, `cat,` → `cat`, `'cat'` → `cat`); a token with no
letters (`—`, `...`) is skipped; a token containing a digit, or any non-letter
between its letters (`sun-hat`, `b3d`, `2`), is **not** silently skipped but
reported as `bad_token` — otherwise a displayed number would slip past the word
check. Words with apostrophes need no special case: `can't` is simply not in
the lists, so it comes back as `word`. Duplicate lines and the `low_variety`
ratio are computed on the body only (the title is checked for words only), and
line word counts come from the same tokeniser.
`scripts/validate.js` exports `validatePools({root, steps, banks, scope})` and
runs as a CLI only when invoked directly: `npm run validate [-- --step N]`
validates every `stories/step-*.json` (or just that step), prints one line per
failure via `formatError` plus a per-pool `k/n stories pass` line, exits 1 on
any failure, 2 on a bad argument or unreadable data files, 0 otherwise. A
missing pool file is skipped with a note; with no pools at all it prints
"no story pools found, nothing to check" and exits 0 (observed now, since no
pools exist yet). A pool whose own `step` disagrees with its file name is a
failure.
**Tests:** `test/validate.test.js`, 19 tests — a valid step-2 baseline story,
the poisoned `through` case (rejected with the word and line named), a step-3
word (`ship`) in a step-2 story that passes at step 3, a name not in the bank
(`Milo`) vs one that is (`Bob`), the title being validated, heart words
(`said` legal at 3, not at 2), punctuation stripping and case-insensitivity,
`tokenize`/`normalizeToken` directly, an apostrophe word, a digit token, each
R3 rule (with its just-passing counterpart), the shape errors, "every error is
reported", a precomputed `allowed` set, and two `validatePools` tests over
temp story dirs (clean + poisoned pool; missing pool skipped, mislabelled pool
flagged, empty dir).
**Results:** `node --test test/validate.test.js` 19/19; `npm test` 56/56;
`npm run validate` exits 0 with "no story pools found".
**Deliberately left:** no duplicate-`id` or cross-story near-duplicate check
(step 4 and steps 5a–5e own that); no `--root` flag on the CLI (tests call
`validatePools` directly).
**Changes later steps:** the prototype stories mostly fail R3 — see Found
along the way. Steps 5a–5e must not simply copy them in.


### [x] 4. Generator
Files: `scripts/generate.js`, `lib/prompt.js`, `test/generate.test.js`.
- `npm run generate -- --step N --count K [--max-attempts 5]`. Loads `.env` if
  present (use `process.loadEnvFile` guarded by existence). Fails fast with a
  clear message if `ANTHROPIC_API_KEY` is unset.
- Prompt per the spec's "Generation prompt shape", built in `lib/prompt.js`
  from the step's cumulative bank + heart words. To keep variety with a large
  bank, include the full allowed list but also name 8–12 randomly chosen
  "focus words" from the current step's own bank to feature.
- Parse the model's JSON (tolerate a fenced ```json block), build a story
  object with the spec's fields (`id` = `s{step}-{4 hex}`, unique in pool;
  `words_used`; `validated_at`; `generator` = model id), validate with
  `lib/validate.js`, reject near-duplicates of stories already in the pool
  (same title or ≥ 50% identical lines), append passing stories to
  `stories/step-N.json` (atomic write). Up to `--max-attempts` attempts per
  story; every reject appended to `logs/rejects.jsonl` with step, attempt,
  errors and the raw text. Print a summary: accepted, attempts, reject rate,
  top 10 rejected words.
- The Anthropic client is injectable (`generate({client, ...})`) so tests use
  a fake that returns canned responses; tests cover accept, reject-then-accept,
  give-up after max attempts, reject logging, and duplicate detection. Tests
  never hit the network.
Done when: `node --test test/generate.test.js` passes and running the CLI with
no key prints the missing-key message and exits non-zero.

**Done:** **No real generation was performed — there is no API key on this
machine and no request was ever sent to the Anthropic API.** Everything below
was exercised with an injected fake client only.
`lib/prompt.js` (pure, imports only `./bank.js`) exports `buildPrompt({step,
banks, scope, focus?, rand?})` → `{text, bankWords, heartWords, focus}`,
plus `stepBankWords(step, banks)`, `pickFocusWords(words, rand, count)` and
`FOCUS_MIN`/`FOCUS_MAX` (8/12). `text` is the spec's prompt verbatim — same
heading line, the same five rules, the same `Return JSON: { "title": string,
"lines": string[] }` tail — with the cumulative bank (steps 1..step, hearts
removed so no word appears in both lists, sorted) under "You may use ONLY these
words:", the cumulative hearts after "Plus these heart words:", and one extra
line, "Feature several of these words from this step: …", holding 8–12 words
drawn at random from the *current* step's own bank. `rand` is injectable, so
the prompt is deterministic in tests.
`scripts/generate.js` exports `generate({client, step, count, maxAttempts,
root, banks, scope, model, rand, now, log})` → `{step, model, requested,
accepted, attempts, rejects, gaveUp, rejectedWords}`, plus `parseStoryJSON`,
`responseText`, `findDuplicate`, `makeId`, `readPool`/`writePool`, `parseArgs`,
`formatSummary` and the constants `DEFAULT_MODEL` (`claude-sonnet-4-6`),
`DEFAULT_MAX_ATTEMPTS` (5), `MAX_TOKENS` (2000), `DUPLICATE_LINE_RATIO` (0.5).
A "client" is anything with `messages.create({model, max_tokens, messages})`
resolving to `{content:[{type:'text',text}]}` — the real `@anthropic-ai/sdk`
client is only constructed inside `main()`, and only after the key check, so
the module can be imported with no key and no network.
Per story it loops up to `maxAttempts` model calls: parse (a ```json or bare
fence is unwrapped, otherwise the first `{`…last `}` is taken), build the story
(`id` = `s{step}-{4 hex}`, unique against the pool and the run's own
acceptances; `step`; `title`; `lines`; `words_used` = the validator's `words`;
`validated_at` = ISO now; `generator` = the model id), `validateStory` against
`allowedWords(step, banks, scope)` computed once, then the near-duplicate check
(same title, or ≥ 50% of the candidate's lines shared with a pool story —
both compared through `tokenize`, so case and punctuation don't matter). A pass
is appended to `stories/step-N.json` and the whole pool is rewritten atomically
(tmp + rename) after each acceptance, so a crash mid-run keeps what was
accepted. Anything else — a thrown client error, unparsable text, a validator
failure, a duplicate — is one line in `logs/rejects.jsonl`
(`{at, step, story, attempt, model, reason, errors, raw}`; the raw response is
kept, which is the point of the log) and the attempt is retried.
CLI: `npm run generate -- --step N [--count K] [--max-attempts 5] [--model ID]`.
It parses args first (exit 2, with usage, on a bad or missing `--step`), then
loads `.env` via `process.loadEnvFile` guarded by `existsSync` **and** by
`typeof process.loadEnvFile === 'function'`, then fails with exit 2 and a
three-line message naming the `.env` path if `ANTHROPIC_API_KEY` is unset, then
checks the step exists in the scope sequence. Model = `--model` ›
`GEN_MODEL` › `claude-sonnet-4-6` (R8). It prints one line per acceptance and
per rejection and then the summary: accepted/requested, attempts, reject count
and rate, stories given up on, and the top 10 rejected words with counts.
Exit 1 if nothing was accepted.
**Tests:** `test/generate.test.js`, 21 tests, all against a fake client and a
temp root — accept (checks the whole stored story shape and that the pool file
is written), reject-then-accept with the reject-log contents checked, give-up
after `--max-attempts` (no pool file created), an R3 failure, duplicate lines,
duplicate title, two stories in one run compared against each other, a thrown
client error and unparsable prose, a fenced reply, the `claude-sonnet-4-6`
default, and units for `parseStoryJSON`, `responseText`, `findDuplicate`,
`makeId`, `parseArgs`, `buildPrompt` (shape, only-legal-words, hearts and bank
disjoint, later steps excluded, 8–12 focus words from this step's own bank,
determinism) and `pickFocusWords`. Two tests spawn the real CLI: bad args → 2,
and no key → 2 with the missing-key message (that one is **skipped if a `.env`
exists**, so it can never reach the network).
**Results:** `node --test test/generate.test.js` 21/21; `npm test` 77/77;
`env -u ANTHROPIC_API_KEY node scripts/generate.js --step 2 --count 3` prints
the missing-key message and exits 2. No `stories/` or `logs/` directory was
created in the repo (tests write to temp dirs only).
**Deliberately left:** the generator is not wired to top up an existing pool by
target size (it generates `--count` new stories, as the plan says); no
`--root`/`--dry-run` flags; no retry/backoff on HTTP errors beyond the normal
attempt loop (a thrown error counts as one rejected attempt); no prompt
caching, no `thinking`/`output_config`, and no streaming — a story is ~2000
output tokens at most.
**Changes later steps:** none. Steps 5a–5e still hand-write the pools;
`findDuplicate` in this file is the mechanical duplicate check they can reuse
(import it, or copy the rule: same tokenised title, or ≥ 50% shared tokenised
lines). Step 8's README should document `--model` and `GEN_MODEL` alongside
`--step`/`--count`.


### [x] 5a–5e. Claude-written story pools, steps 1–5 (one sub-step per pool)
The user chose to have Claude write the stories directly instead of calling an
API (no key needed, no API cost). One subagent per pool: **5a** = step 1,
**5b** = step 2, … **5e** = step 5. Each is verified before the next starts.
Files (per sub-step): `stories/step-N.json` only, plus scratch files under
`<scratchpad>/` if useful.
- Target **100 stories** in the pool, in the spec's story shape: `id`
  `s{N}-{4 hex}` (unique), `step`, `title`, `lines`, `words_used`,
  `validated_at` (the time the story passed), `generator: "claude-opus-5 (hand-authored)"`.
- Each must be an actual story (something happens, and it ends), 6–9 lines,
  3–7 words per line, varied sentence openings (not every line "The …"),
  names only if they are in the bank. Include the prototype's story for that
  step if it passes the validator.
- Write in batches of ~10, run every batch through `lib/validate.js`
  (`validateStory` with the real banks and scope), rewrite failures, and only
  then append. **Never add words to a bank to make a story pass** — rewrite
  the story. Words you kept wanting go in **Found along the way**, with counts
  (this stands in for the spec's reject log).
- No near-duplicates: no repeated titles, and no two stories sharing ≥ 50% of
  their lines (case-insensitive). Check this mechanically over the whole pool.
- If the step's bank is too small to reach 100 genuinely different stories
  (likely at step 1: short a only), stop where quality holds and record the
  number and the reason. Do not pad with near-copies.
Done when: `npm run validate -- --step N` exits 0; a script check shows
unique ids, unique titles, and no pair of stories sharing ≥ 50% of lines; the
Done notes record the count and the rewrite rate (stories that failed
validation at least once / stories written).

Sub-steps: [x] 5a (step 1) · [x] 5b (step 2) · [x] 5c (step 3) · [x] 5d (step 4)
· [x] 5e (step 5)

**Done (5a, step 1):** `stories/step-1.json` holds **100 stories**, the full
target — the step-1 bank turned out to be just large enough. **No API call was
made; every story is hand-written** (`generator: "claude-opus-5
(hand-authored)"`). Method as the plan says: a scratch script (in the session
scratchpad, not the repo) importing `validateStory` + `allowedWords` and
`findDuplicate`, candidates written in batches of 6–14, every failure rewritten,
only passing stories appended to the pool by a second scratch script that
re-validates, re-checks `findDuplicate` against the whole pool, assigns the id
(`makeId`), `words_used` = the validator's `words`, and `validated_at` = the
moment it passed. Stories are 6–8 lines, 3–7 words a line; distinct-word ratios
run 0.600–0.706 (median 0.634) against the 0.60 floor, which was left at 60%
as the user decided.
**Rewrite rate: 20 of 100 stories (20%) failed validation at least once**, over
22 failure events. **The most common failure code is `low_variety` — it is 22
of the 22 events**, i.e. every single failure; one of those stories also had a
`word` error ("in" in the title "A Rat in a Cap", rewritten as "The Rat and the
Cap"). Nothing else ever fired: no `line_too_long`, no `duplicate_line`, no
duplicate title or ≥50%-shared-lines rejection, because the variety budget is so
tight that it binds long before any other rule does. The whole pool passes the
same checks: `npm run validate -- --step 1` → "100/100 stories pass", exit 0;
a whole-pool script check → 100/100 unique ids (all `s1-[0-9a-f]{4}`), 100/100
unique titles, 0 pairs sharing a title or ≥ 50% of lines (checked both
directions), all seven fields present and no extras.
**Words I kept wanting that are not in step 1** (a hand-kept tally while
writing — this stands in for the API reject log; none of these ever reached the
validator, because a bank word was substituted or the sentence was rewritten):
`it` ~25 (by far the worst: with no pronoun, every reference repeats the noun,
which is exactly what the 60% rule punishes); `on` ~20 and `in` ~15 (the
natural "sat on the mat" / "in the bag" — both are step-2 words); `he/she/him/
his`-as-subject ~20 (only `his` exists at step 1, so names must be repeated);
inflected verbs `pats taps naps runs sits` ~15 (the bank has bare forms only,
so nearly every story is `had`/`has`/`can` or past `ran`/`sat`); `not`/`no` ~10
(negation is impossible at step 1); `of` ~8 ("a bag of jam", "a vat of sap");
`big/little/hot` ~8 (the only adjectives are fat, tan, bad, mad, sad); `got`
`went` `saw` `said` ~8; `was` ~6; `up` and `then`/`at last` ~6; possessive
apostrophes (`Dad's hat`) ~4. Also: **`am` and `an` are in the step-1 bank but
are unusable** — `am` needs `I` (a step-2 heart) and `an` needs a vowel-initial
noun, and the only vowel-initial step-1 words are `at am an`. They are the only
two of the 58 bank words the pool never uses; the other 56 plus all 8 heart
words are used.
**What that implies for 5b–5e:** the binding constraint at step 1 is variety,
not decodability, and it is caused by the missing function words. Step 2 adds
`in on it up not got big` and the hearts `i of no go put`, so pronouns, negation
and prepositions all arrive at once; `low_variety` should stop dominating and
the later pools can afford longer sentences and a repeated subject. The pool-level
smell to watch (visible here) is filler lines reused across stories — the pool
has 699 lines, 592 of them distinct, with a few "Nan had jam and a yam."-type
lines appearing up to 5×. That is legal (`findDuplicate` only rejects ≥ 50% of one
story's lines) but it is the padding the plan warns about, so later pools should
vary the connective lines, not just the nouns.
**Deliberately left:** the prototype's step-1 story is not included — it is one
of the four the step-3 notes found to be `low_variety` (12/34) and rewriting it
would have made it a different story with a used-up title. No `logs/rejects.jsonl`
was written (that file belongs to the API generator; the tally above replaces
it). Nothing was committed to git.

**Done (5b, step 2):** `stories/step-2.json` holds **100 stories**, the full
target. **No API call was made; every story is hand-written**
(`generator: "claude-opus-5 (hand-authored)"`). Method as 5a: a scratch script in
the session scratchpad (not the repo) importing `validateStory` + `allowedWords`
from `lib/` and `findDuplicate` + `makeId` from `scripts/generate.js`; candidates
written in batches of 6–15, every failure rewritten, only passing stories
appended by the same script, which re-validates, re-runs `findDuplicate` against
the whole pool plus the batch's own acceptances, assigns the id, sets
`words_used` = the validator's `words` and `validated_at` = the moment it passed.
Stories are 7–9 lines, 3–7 words a line; distinct-word ratios run 0.600–0.767
(median 0.640) against the 0.60 floor, left at 60% as the user decided.
**Rewrite rate: 10 of 100 stories (10%) failed at least once**, over 13 failure
events. **The most common code is `low_variety` — 8 of the 13**; the other
five are 4 × `word` (`digs` in a title, `my`, `quilt`, `me`) and one
words-per-line failure that the *validator does not catch*: an 8-word line,
legal under R3's max of 9 but outside the plan's 3–7, found by the whole-pool
check and rewritten. Every failure was in the first two batches (6/10 then
4/10); batches 3–8 were 12/12, 14/14, 14/14, 15/15, 14/14, 11/11 — once the
shape below was fixed, nothing failed again.
**The shape that works at step 2:** 7–8 lines of 5–6 words, with **four or more
distinct props or characters per story**. What sinks the ratio is a story with
one prop: a 7-word line carries 2–3 articles, so a repeated noun plus
`the/a/it/is` puts you at 0.55 fast. Rewriting a `low_variety` story always
meant adding a *new noun or character*, never shortening.
**Words I kept wanting that are not allowed at step 2** (hand tally while
writing; none reached the validator — this stands in for the API reject log):
**plurals of anything** ~40, by far the worst — inflected `-s` starts at step 4,
so `bugs kids figs pigs` are impossible and "six/ten + noun" ideas all died;
`he`/`she`/`they` ~30 (step 2 has `I him his it us` but no third-person
*subject*, so every sentence repeats a name or opens with Up/In/At — this is what
drives `low_variety`); `was` ~15; `said` ~12; `see`/`look` ~10; `with` ~10;
`went` ~8; `then` ~8; `off` ~8; `now` ~6; `so` ~6; past-tense verbs beyond
`had got did sat ran hid fed led met cut put let bit` ~15 (`fell`, `jumped`,
`looked`); `help` ~6; adjectives beyond big/hot/wet/red/tan/fat/sad/mad/bad/dim/fun
~10 (`little`, `glad`, `cold`); `or` ~5; possessive apostrophes (`Mom's pin`) ~4;
`all` ~4; `tell` ~4; `one` ~3; `too` ~3; `eat` ~3.
**Coverage:** 180 of the 211 allowed words are used. Never used (31):
`am an as beg bet bid dab dan fin hip if jab lad led lit men met mob nod pod ram
rib rid rob rot sag sap sum tab tag zap`. Unlike 5a, `am` and `an` are now
*usable* (`i` is a step-2 heart word) — I simply never reached for them.
**Repeated-line distribution** (the pool-level smell 5a flagged): 787 lines,
**769 distinct; 751 appear once, 18 appear twice, none appears three or more
times.** 5a's pool was 699 lines / 592 distinct with lines up to 5×, so the
"vary the connective lines" instruction held. The 18 doubles are all short
formulas (`mom did not get mad`, `yes it is a fun job`, `up up it is fun`).
**Whole-pool check:** `npm run validate -- --step 2` → "100/100 stories pass",
exit 0. A scratch pool script → 100/100 unique ids (all `s2-[0-9a-f]{4}`),
100/100 unique case-insensitive titles, **0 near-duplicate pairs** (`findDuplicate`
run both directions over all 9900 ordered pairs), all seven fields present and no
extras, `words_used` byte-identical to the validator's `words` for every story,
every `validated_at` parseable, 7–9 lines per story, every line 3–7 words.
`npm run validate` (both pools) exits 0; `npm test` 77/77.
**What that implies for 5c–5e:**
- **Step 3 removes the binding constraint.** Its hearts are `he she we me be was
  you said what my do so` — third-person subjects, past tense and dialogue all
  arrive at once, plus `sh ch th ck wh ng nk qu` for `this that then them with
  much such wish`. `low_variety` should stop binding at all; 5c can afford
  longer sentences and dialogue.
- **Plurals are still illegal until step 4.** 5c must keep the
  no-plurals discipline; 5d is the first pool that can use them, and it should,
  because it is the single biggest unlock.
- **Put the plan's own shape rules in the batch harness.** The validator's R3
  floors (≥5 lines, ≤9 words) are looser than the plan's (6–9 lines, 3–7 words);
  one 8-word line survived eight batches because only the pool script checked it.
  5c should check lines-per-story and words-per-line in the batch script.
- Keep the line-reuse map: counting how many pool stories already contain each
  candidate line, and rejecting at 2, is what kept the maximum at 2×.
**Deliberately left:** the prototype's step-2 story is not included — step 3's
notes found it `low_variety` (21/39) with a 10-word final line, and the plan's
"if it passes" makes dropping it the honest reading. No `logs/rejects.jsonl`
(that file belongs to the API generator; the tally above replaces it). Nothing
was committed to git.

**Done (5c, step 3):** `stories/step-3.json` holds **100 stories**, the full
target. **No API call was made; every story is hand-written**
(`generator: "claude-opus-5 (hand-authored)"`). Method as 5a/5b: a scratch
harness in the session scratchpad (not the repo) importing `validateStory` +
`tokenize` from `lib/validate.js`, `allowedWords` from `lib/bank.js`, and
`findDuplicate` + `makeId` from `scripts/generate.js`. Per 5b's third lesson the
harness checks **the plan's own shape rules as well as the validator's** —
6–9 lines and 3–7 words a line, not just R3's ≥5/≤9 — and per 5b's fourth it
keeps the **line-reuse map, rejecting any candidate line already in 2 stories**.
Eight batches of 11–13; every failure rewritten in place and the batch re-run;
nothing appended until the whole batch passed. Distinct-word ratios run
0.600–0.778 (median 0.667) against the 0.60 floor, left at 60% as the user decided.
**Rewrite rate: 15 of 100 stories (15%) failed at least once**, over 16 failure
events (5a was 20%, 5b 10%). **The most common code is `low_variety` — 10 of the
16**; the rest are 5 × `word` and 1 × the plan-only words-per-line rule.
The five `word` failures are worth naming because four of them are the trap
5b flagged or its cousin: `sits` (in a title — an `-s` verb ending, step 4),
`pegs` (a plural, step 4), `sand` and `lug` (`sand` is a final blend, step 4;
`lug` is simply not a bank word), and `have` (a **step-5** heart word, used in a
title). Per batch the failures were 1, 4, 4, 2, 1, 1, 0, 2 — unlike 5b they did
not concentrate in the first two batches, because `low_variety` at step 3 is
driven by subject matter, not by a shape that can be learned once.
**The shape that works at step 3:** 8 lines of 5–7 words, and **the central noun
of the title mentioned at most three times in the body**. Every one of the 10
`low_variety` failures was a story that leaned on one prop (wig, bunk, rat,
tank, chick, pin, duck): with a 5–7 word line carrying 2–3 of
`the/a/it/is/did`, a fourth mention of the title noun is what crosses the floor.
The fix was always a *second named character* or a second prop, never a shorter
line. Dialogue helps the ratio (it brings `said`, a name, `you`, `my`), so it is
both the thing step 3 unlocks and the cheapest variety.
**Words I kept wanting that are not allowed at step 3** (hand tally while
writing; none reached the validator except the five above — this stands in for
the API reject log): **plurals and `-s` verb endings ~45**, still the worst and
still step 4; **consonant blends ~35** (`stop still best last next list clap
spot stick splash grin hand sand wind help flip spin crack drum lamp stuff frog
grass sled band hunt quilt` — at step 3 the *structure* rule bites more than the
grapheme rule); **past-tense `-ed` ~25** (every verb has to be one of
`had got did sat ran hid fed led met cut put let bit fell sang rang hung sung
sank shot shut quit` or be paraphrased as `did` + bare verb, which is why `did`
is the pool's most repeated word); **`her` ~20** — the single most surprising
gap: step 3 gives `she` but there is no feminine object or possessive, so a
girl's name must be repeated where a boy's can become `him`/`his`;
**`they`/`them` as subject ~18**; `for` ~10; `out down now here away` ~12;
`see`/`look` ~10; `all too one two both` ~12; `went came saw` ~10;
`are have come some` ~8; `home why how where who` ~8; `little good cold old` ~6;
possessive apostrophes ~4.
**Coverage:** **all 138 step-3 bank words are used** and **all 12 step-3 heart
words** (`he she we me be was you said what my do so`); 300 of the 361 allowed
words appear. Every one of the 100 stories contains at least one step-3 bank word.
**Digraph coverage** (stories containing ≥1 step-3 bank word with that
grapheme / token count): `th` 96 stories, 245 tokens · `ck` 83/222 · `sh` 69/165
· `ll` 69/139 · `ch` 53/88 · `ss` 34/61 · `ff` 35/39 · `nk` 33/48 · `qu` 32/36 ·
`ng` 30/87 · `zz` 8/14 · **`wh` 7/10 — the one thin spot**, because the bank has
only `when which whip whiz` and three of those are hard to place in a 6-year-old's
story. `zz` is thin for the same reason (`buzz fizz jazz`).
**Repeated-line distribution:** 801 lines, **800 distinct; 799 appear once, one
appears twice (`then he got it`), none appears three or more times.** Better
than 5b (787/769, 18 doubles). The reject-at-2 rule never actually fired — at
step 3 the vocabulary is wide enough that filler lines stop recurring by themselves.
**Whole-pool check** (`poolcheck.mjs` in the scratchpad): 100/100 unique ids
(all `s3-[0-9a-f]{4}`), 100/100 unique case-insensitive titles, **0 near-duplicate
pairs** (`findDuplicate` over all 9900 ordered pairs), all seven fields present
and no extras, `generator` correct and `validated_at` parseable for all 100,
`words_used` byte-identical to the validator's `words` for every story, 6–9 lines
and 3–7 words per line for every story. `npm run validate -- --step 3` →
"100/100 stories pass", exit 0; `npm run validate` (all three pools) exits 0;
`npm test` 77/77.
**What that implies for 5d–5e:**
- **Set a line count per story in the batch file.** This pool is 99 stories of
  8 lines and 1 of 9 — inside the plan's 6–9 but uniform. A retrofit pass
  (script in the scratchpad) found that across 100 stories there was exactly
  **one** adjacent line pair that could merge (sum ≤ 7 words) and **one** line
  that could split at an internal sentence boundary: 5–7-word single-sentence
  lines are structurally unmergeable and unsplittable. Line-count variety has to
  be written in, it cannot be added afterwards.
- **Step 4 is the big unlock: 270 new allowed words**, including plurals, `-s`
  verbs, every blend, `they` and `are`. 5d should lead with the plurals — they
  kill the "six/ten + noun" idea that died in both 5b and 5c.
- **`her` is in no bank or heart list through step 5** (it first appears at step
  10). 5d and 5e still cannot write "Mom got her hat", so keep using names for
  female characters, or record it as a bank gap if it starts to bind.
- The `low_variety` rule of thumb above (≤3 mentions of the title noun, always
  fix by adding a character) transfers directly; at step 4 it should bind less
  because plurals and blends widen the noun supply.
**Deliberately left:** the prototype's step-3 story is not included — step 3's
Found-along-the-way notes measured it at `low_variety` (24/47), and the plan's
"if it passes" makes dropping it the honest reading. No `logs/rejects.jsonl`
(that file belongs to the API generator; the tally above replaces it). Nothing
was committed to git.

**Done (5d, step 4):** written by the main agent after the fact. The 5d subagent
wrote all 100 stories to `stories/step-4.json`, then stopped on a session rate
limit (HTTP 429) before writing these notes or reporting. Its rewrite rate,
failure codes, wanted-word tally and blend-coverage figures were **not
recorded and are lost**. Verified afterwards by the main agent:
`npm run validate -- --step 4` → 100/100 pass; 100 unique ids (all
`s4-XXXX`), 100 unique titles; `findDuplicate` against the rest of the pool →
0 near-duplicates; `words_used` matches the validator's `words` for every
story; `generator` exact; no line outside 3–7 words; no line used twice in the
pool; line counts `{6:25, 7:25, 8:25, 9:25}` (5c's lesson applied); all 100
stories use at least one step-4 bank word. Three stories read in full (Fran and
the Lost Flag, The Drink Stand, A Pinch of This) — coherent, with a beat and an
ending.

**Done (5e, step 5):** `stories/step-5.json` holds **100 stories**, the full
target. **No API call was made; every story is hand-written**
(`generator: "claude-opus-5 (hand-authored)"`). Method as 5a–5c: a scratch
harness (`s5/harness.mjs` in the session scratchpad, not the repo; 5d's harness
with STEP=5) importing `validateStory` + `tokenize` from `lib/validate.js`,
`allowedWords` from `lib/bank.js`, and `findDuplicate` + `makeId` from
`scripts/generate.js`. It checks the validator, the plan's shape (6–9 lines,
3–7 words a line), a declared line count per story (`want`, set before writing),
duplicate titles, `findDuplicate` against the pool plus the batch, the
line-reuse map (reject at 2), a `her` guard, and a self-imposed **≥ 3 distinct
magic-e words per story** (counted from the step-5 bank entries that have an
`s`-kind grapheme). Every failed attempt was appended to a failure log. Eight
batches (7 × 12, then 16), every failure rewritten and the batch re-run;
nothing appended until the whole batch passed. These notes were updated after
every accepted batch. The prototype's step-5 story is **included unchanged** as
"Jake and the Snake" (7 lines; it passes the validator and the shape rules as
it stands, and a title was added because the prototype has none).
**Rewrite rate: 22 of 100 stories (22%) failed at least once**, over 23 failed
attempts carrying 24 errors (5a 20%, 5b 10%, 5c 15%). **The most common code is
`low_variety` — 11 of the 24**; then 8 × `word` (`spots` ×2, `last`, `puts`,
`buns`, `cuts`, `lids`, `pups`) and 5 × the plan-only words-per-line rule (an
8-word line). Neither the `her` guard nor the magic-e minimum ever fired. Per
batch the failing stories were 3, 4, 1, 1, 2, 2, 4, 5. Every `low_variety`
fix meant adding a new noun or character, or cutting a repeated title noun
(`crane`, `stone`, `tube`, `lake` ×3–4), as 5b and 5c found. It did not mean
shortening lines. Distinct-word ratios run 0.600–0.846 (median 0.676), with the
floor left at 60% as the user decided.
**Words I kept wanting that are not allowed at step 5** (a rough hand tally
while writing; only the eight above reached the validator, and the tally stands
in for the API reject log):
- **`-s` forms missing from the banks, ~70**, by far the biggest class. Verbs:
  `spots puts cuts lifts pops hums grins swims swings rolls comes gives bites
  takes bakes tapes tips taps drips stacks adds holds helps walks says looks
  plays stays`. Nouns: `pups buns lids plums twigs dimes grapes plates vans jugs
  tins dots bits pals`. The step-4 and step-5 banks list only selected
  inflections, so the bare word is legal and its `-s` form is not. Every one of
  the eight `word` failures was this, or `last`.
- `more`/`again`/`new` ~13; `two`/`three`/`first` ~9; `out down now here too
  by under` ~12.
- `for` and `see`/`look`: a few each in the tally, but reached for more often
  than it records.
- `end`/`last` ~6; `play`/`show` ~5; `walk`/`wait`/`sleep`/`push`/`splash`/`race`
  ~2 each; `her` ~1 (sidestepped by repeating the girl's name, as in 5c/5d).
**Magic-e coverage per vowel** (stories containing ≥ 1 split-digraph word / tokens):
**a_e 86 / 401 · i_e 86 / 264 · o_e 60 / 159 · u_e 41 / 171**. u_e is the thin
one as expected. 11 of its 41 stories get their u_e only from the names Luke or
June. **Counting only non-name u_e words, it is in 30 stories**: `mule` 26
tokens, `tune` 21, `tube` 13, `rule` 11, `cute` 9, `cube` 8, `flute` 5, `rules`
3, `tubes` 2. Every story has 3–11 distinct magic-e words (median 6); 134 of
the 139 magic-e bank words are used. Never used: `date pride spine shape
lines`. All 100 stories contain a step-5 bank word, and 459 of the 779 allowed
words appear.
**Line-count distribution:** `{6:25, 7:25, 8:25, 9:25}`, declared per story
before writing. **Repeated-line distribution: 750 lines, 750 distinct**; no line
appears in two stories. As at step 3, the reject-at-2 rule never fired. Line
openers: 105 distinct first words. The most common are `It` 70 (9%), `Then` 53,
`The` 49, `He` 37.
**Whole-pool check** (`s5/poolcheck.mjs` in the scratchpad): 100/100 pass the
validator; 100/100 unique ids (all `s5-[0-9a-f]{4}`); 100/100 unique
case-insensitive titles; **0 near-duplicate pairs** (`findDuplicate` over all
9900 ordered pairs); all seven fields present and no extras; `generator` exact
and `validated_at` parseable for all 100; `words_used` byte-identical to the
validator's `words`; 0 line-count or words-per-line violations; no `her`.
`npm run validate` (all five pools) → each 100/100, "validate: ok", exit 0;
`npm test` 77/77.
**What this means for later steps:**
- **The `-s` gap is now the binding bank gap** (see Found along the way). It
  causes most `word` rejects, and an API generator will reach for these words
  constantly.
- **u_e has two sounds in the pool:** /juː/ in `mule cute cube` and /uː/ in
  `tune rule flute tube June Luke`. If step 6/7's tray ever shows phonemes
  rather than graphemes, these need `sounds` (the step-2 Found note already
  flags this).
- `mike` is both a name and a bank word at step 5. It is used only as a name
  (and in "Big Mike", a plane's name), which is harmless for the validator.
**Deliberately left:** no `logs/rejects.jsonl` (that file belongs to the API
generator; the tally above replaces it). Nothing was committed to git.

### [x] 6. Client logic: segment, rotation, progress helpers
Files: `lib/segment.js`, `lib/rotation.js`, `lib/progress.js` (extend),
`test/segment.test.js`, `test/rotation.test.js`, `test/progress.test.js` (extend).
- `segment(word, index)`: bank entry's `g` if present (preserving the original
  word's casing letter-for-letter), else the Appendix A splitter; returns
  `[{t, k, sound?}]`. Tests: every entry in banks 1–5 segments to its own `g`;
  `ship`, `make`, `Jack`; unknown-word fallback.
- `pickStory(pool, progress, step)`: keep serving `progress.current_story[step]`
  while its reads < 3 and it is still in the (validated) pool. Otherwise pick,
  in order: unseen stories; then stories with reads < 3, fewest reads first;
  then (everything has had 3 reads) oldest-first by last-read session. Never
  return `progress.last_story[step]` if any other story exists. Returns `null`
  on an empty pool. Deterministic given its inputs (take an optional `rand`).
- Progress helpers (pure, return new objects): `recordSession(progress,
  {story_id, step, stumbles:[words], date})` — appends to `sessions`
  (keep last 60), increments `stumbles[w]`, adds to `seen`; `setReads`;
  `promote(progress, toStep, date)` appends to `step_history`;
  `warmupWords(progress, story, index, today)` — up to 6 stumble words from
  sessions **before today**, most-stumbled first, restricted to words allowed at
  the current step, followed by story words from the current step's own bank,
  deduped, max 14; `readiness(progress, step)` — `{stories_read, avg_reads,
  first_session_stumbles, last_session_stumbles, sessions}` for the hint.
Done when: `node --test test/segment.test.js test/rotation.test.js test/progress.test.js` passes.

**Done:** Three browser-safe ES modules (no `node:` imports, no Node globals;
`lib/progress.js` now imports `tokenize` from `./validate.js`, which imports
`./bank.js` — both already browser-safe). **Signatures step 7 calls:**
- `lib/segment.js`: `segment(word, index)` → `[{t, k, sound}]`. `word` is a
  bare word in any casing; `index` = `buildIndex(banks)`. Uses the bank's `g`
  when the word is in the index, else the Appendix A splitter (plus `ll ss ff zz`
  as kind `d`, the bank convention). `t` keeps the original casing so the texts
  join to `word` letter-for-letter (`Jack` → `J·a·ck`). `sound` is the tray
  label with slashes: default `"/"+lowercase text+"/"` (`/sh/ /i/ /p/`, and also
  `/ck/ /ll/ /qu/`, as the prototype shows), overridden from `sounds` via
  `SOUND_LABEL` (`s:z`→`/z/`, `ea:short-e`→`/e/`, `ea:long-e`→`/ē/`,
  `oo:long-oo`→`/oo/`, `oo:short-oo`→`/ŏŏ/`, `ow:ou`/`ou:ow`→`/ow/`,
  `ow:long-o`→`/ō/`, `ed:t`→`/t/`, `es:iz`→`/iz/`, `le:ul`→`/ul/`); the vowel
  before a silent `e` gets its long name `/ā/ /ē/ /ī/ /ō/ /ū/`; the silent `e`
  itself has `sound: null` (the tray skips it, as the prototype does). Long
  vowels are written as vowel + U+0304 combining macron, breves as U+0306.
  Also exported: `isHeartWord(word, hearts)` (case-insensitive; `hearts` =
  `heartWords(step, scope)`) — **step 7 must check it before calling `segment`**,
  because hearts are in no bank and would otherwise get the fallback split;
  `splitToken(token)` → `{pre, word, post}` (letters + internal apostrophes, original
  casing; `pre+word+post === token`) for rendering a story token; `fallbackGraphemes(word)`;
  `SOUND_LABEL`.
- `lib/rotation.js`: `pickStory(pool, progress, step, rand?)` → story object or
  `null`. Tiers exactly as the step says; besides `last_story[step]` it also
  excludes the current story once it has 3 reads (unless nothing else exists).
  "Oldest by last-read session" = the story's latest index in `progress.sessions`;
  a story with no retained session counts as oldest. `rand` only breaks ties
  inside a tier; omitted, the tie goes to pool order. `MAX_READS` = 3.
- `lib/progress.js` (all return a new normalized object, inputs untouched; the
  caller passes dates as `'YYYY-MM-DD'`):
  `setCurrentStory(progress, step, storyId)` — **not in the step text, added
  because rotation depends on it**: sets `current_story[step]`, and the story it
  replaces becomes `last_story[step]`. Step 7 should call it whenever it serves
  a different story, including for "Different story".
  `setReads(progress, storyId, n)` — clamps to integer 0..3; 0 deletes the key.
  `recordSession(progress, {story_id, step, stumbles, date})` — appends
  `{story_id, step, date, stumbles:[distinct lowercase words]}`, keeps the last
  60 (`MAX_SESSIONS`), adds 1 to `stumbles[w]` per distinct word, adds the id to
  `seen`. `promote(progress, toStep, date)` — appends `{step: <step left>, to:
  toStep, promoted_at: date}` (the spec's example stores the step left: `{step:1}`
  while `current_step` is 2) and sets `current_step`; used for "Go back a step" too;
  a same-step call is a no-op; throws `RangeError` on a non-integer or < 1.
  `warmupWords(progress, story, index, today, {hearts?, step?})` → array of
  strings: up to 6 (`MAX_WARMUP_STUMBLES`) words from sessions dated before
  `today`, ranked by the number of such sessions that marked them (ties: most
  recent, then alphabetical), limited to bank words of steps 1..step, plus
  heart words **only if `opts.hearts` is passed**; then the story's title+line
  words from the current step's own bank in reading order; deduped; max 14
  (`MAX_WARMUP`). Lowercase except bank names, which are capitalised (`Josh`).
  `readiness(progress, step)` → `{stories_read, avg_reads, first_session_stumbles,
  last_session_stumbles, sessions}`. Stories are counted by the `s{step}-` prefix
  of the `reads` keys plus the story ids of this step's sessions, with reads ≥ 1.
  `avg_reads` is rounded to 1 decimal. The stumble counts are `null` when there
  are no sessions. They are counted over the retained 60 sessions only.
**Tests:** `test/segment.test.js` has 12 tests:
- every step 1–5 bank entry reproduces its `g` exactly, in text and kind
  (720+ entries), and so does every step 6–10 entry
- `ship`, `make`, `Jack`, casing (`SHIP`, `Then`, `sHiP`)
- `sounds` overrides (`digs rides nose bread moon ate`)
- every `sounds` tag in the banks has a label
- every magic-e entry gives a macron vowel and a null `e`
- the unknown-word fallback (`Zib phone shrill`, with no index, and empty input)
- the fallback agrees with the bank except for magic-e words
- every distinct word in the five pools: 1213 cased forms, >1000 per-pool
  distinct words checked. `splitToken` round-trips every token. Each word is a
  heart word at its pool's step and not in a bank, or a bank word whose
  segments join back exactly, have valid kinds, and have a `/…/` sound or null
  for silent e.
- `isHeartWord`, `splitToken`
`test/rotation.test.js` has 12 tests: every tier, `last_story` in each tier, the
per-step current story, a 12-read full rotation (a, b, c, d, then the oldest),
determinism, and no mutation of deep-frozen inputs.
`test/progress.test.js` has 9 new tests (17 in all). Each helper runs on a
deep-frozen input, which is checked unchanged afterwards. The tests cover the
60-session cap, clamping, the `last_story` hand-off, promote/back/no-op/throw,
normalize round-trips, warm-up ordering, today excluded, bank/heart
filtering, the 6/14 caps, and readiness numbers.
**Results:** `node --test test/segment.test.js test/rotation.test.js
test/progress.test.js` gives 41/41. `npm test` gives 110/110.
**Hand check (the spec's "spot-check one step"):** I printed and read the
segmentation of all 138 step-3 bank words (names capitalised). Every split is
graphemically right and every grapheme has the kind the bank gives it.
**Deliberately left:**
- The fallback is Appendix A as written. On bank words it differs only for
  magic-e words that do not end in `e` (`makes`, `rides` …: it calls the `e` a
  vowel) and for 3-letter `ate`. The bank path makes this irrelevant for every
  served word, and the test pins down exactly this set of differences.
- `u_e` shows `/ū/` for both `mule` and `tune`.
- `th` shows `/th/` for both `this` and `thin`, as already noted below.
**Changes step 7:**
- Tokenise story lines with `splitToken`, and check `isHeartWord(word,
  heartWords(step, scope))` before `segment`.
- Show each grapheme's `sound` (skip `null`) where the prototype built
  `"/"+t+"/"`.
- Call `setCurrentStory` after every `pickStory` that returns a different story.
- Pass `hearts` to `warmupWords` only if heart-word stumbles should reach the
  strip (they then appear as ordinary chips).
- Eyeball that the combining macron (`/ā/`) renders in Andika. fontTools was not
  available here, so I could not check the woff2's cmap.


### [x] 7. Reading app
Files: `index.html`, `app/app.js`, `app/style.css`, `test/app-smoke.test.js`.
- Port `docs/prototype.html`'s look and interaction (R6) into `index.html` +
  `app/style.css` + `app/app.js` (ES module importing `../lib/*.js`).
  `@font-face` for Andika from `/fonts/`; no external requests of any kind.
  The UI font can be the system stack (drop Archivo — it's not worth vendoring).
- Load: `GET /api/progress`, scope sequence, banks, and
  `stories/step-{current}.json`. **Validate every story on load** (R2); drop
  failures and show the parent a small, non-alarming note in the grown-up
  section ("1 story was skipped because it failed the word check"), and log
  details to the console. If the pool is empty after validation, show a plain
  message telling the grown-up to run `npm run generate -- --step N`.
- Replace the prototype's free step strip with a label of the current step
  (the child doesn't choose steps). Story via `pickStory`, warm-up via
  `warmupWords`, heart chips = cumulative heart words that appear in the story
  (or all, if none appear).
- **Stumble log**: a "Mark stumbles" toggle (aria-pressed) in the controls;
  while on, tapping a story word toggles a visible mark on it instead of
  opening the tray. Long-press (≥ 500 ms) on a word does the same without the
  toggle. Heart words can be marked too.
- **Finish** button → session view (one screen, parent-facing): words marked
  this session, count, and the last 5 sessions' stumble counts as a small
  plain list or inline bars — no scores, stars, or praise copy. Records the
  session via `recordSession` and saves progress. "Back to the story" returns.
- **Dots**: three per story, stored in `progress.reads[story.id]` via `setReads`.
- **Grown-up panel** (inside the collapsible notes): readiness hint text in the
  spec's style ("8 stories at step 2, 3 reads each, stumbles down from 11 to 2"),
  a "Move to step N+1" button with a confirm, a "Go back a step" link, and a
  "Different story" button (skips the current one; it becomes `last_story`).
  Promotion is only ever from this button.
- Save progress with `PUT /api/progress` after every change (debounced ~400 ms);
  if the save fails show "Not saved — is the computer running?" in the parent
  area and retry on the next change. Never lose the in-memory state.
- Keep the "How to run this" notes, colour key, dark mode toggle, print CSS
  (hide controls, tray, step label, stumble marks; 26pt lines).
- `test/app-smoke.test.js`: start `createServer` on an ephemeral port with a
  temp data dir; fetch `/`, assert no `http(s)://` references to other hosts in
  `index.html`, `app/*.js`, `app/style.css`; assert every `import` path in
  `app/app.js` resolves with 200.
Done when: `npm test` passes; headless Chromium
(`chromium-browser --headless --screenshot`) renders `/` with a story visible;
a poisoned pool (copy of step-2 with `through` injected into one story, served
from a temp root) shows one fewer story and the skipped note.

**Done:** `index.html`, `app/style.css`, `app/app.js` (ES module importing
`../lib/{bank,validate,segment,rotation,progress}.js`) and
`test/app-smoke.test.js`. Nothing outside those files was edited.
**What the app does:**
- **Look.** The prototype's CSS is ported almost unchanged: tokens, masthead,
  prep panels, tray, story lines, controls, dots, notes, colour key and dark
  mode. The prototype's nested `@media` inside `:root` is rewritten as
  `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){…} }`
  so older iPad Safari understands it. Andika comes from `@font-face` on
  `/fonts/andika-{400,700}-latin.woff2`, and the UI face is the system stack
  (Archivo dropped). `<link rel="icon" href="data:,">` stops a favicon 404.
  There are no images, SVG or decoration.
- **Loading.** `data/scope-sequence.json`, `data/word-banks.json`,
  `GET api/progress`, then `stories/step-{current}.json`. Every story goes
  through `validateStory` with one shared `ctx.allowed`. Stories with a missing
  or duplicate `id` are dropped too. Each drop is logged as
  `console.warn("Skipped story <id> "<title>" at step N: <formatError…>")`, and
  the grown-up panel says "1 story was skipped because it failed the word
  check." (or "N stories were…"). An empty pool (or a 404) shows a plain box:
  "No stories for step N yet … `npm run generate -- --step N`". If
  `GET api/progress` fails, the app starts from `defaultProgress()` but
  **disables saving**, so it cannot overwrite the real file with a fresh start,
  and says so in the save note. `current_step` is clamped to the scope's range.
- **Screen.** The step strip is replaced by a label (`Step 2 all short
  vowels`). The story comes from `pickStory`, followed by `setCurrentStory`
  when the id differs from `current_story[step]`. The title is shown as a
  heading, and its words are tappable, since titles are validated. The
  warm-up is `warmupWords(progress, story, index, today, {hearts, step})`:
  hearts **are** passed, so a stumbled heart word comes back as a dashed purple
  chip, and tapping it gives the heart-word tray. The know-by-heart chips are
  the cumulative hearts in the story, or all of them if none appear.
- **Tray.** Words are tokenised with `splitToken`. `isHeartWord` is checked
  before `segment`. The tray shows each grapheme's `sound` (a null sound is
  skipped), and the silent-e line appears when any grapheme has kind `s`. The
  word after the arrow is lowercase, except bank names and "I". Kind `t` is
  coloured like a vowel.
- **Stumble log.** "Mark stumbles" (`aria-pressed`) makes a tap toggle a mark
  on that word; the mark is per token and is a soft highlight. A long-press of
  500 ms or more does the same without the toggle: it is cancelled by moving
  more than 10 px or by pointerup/cancel/leave, and the click that follows is
  swallowed. Words and the story have `user-select:none`,
  `-webkit-touch-callout:none` and `touch-action:manipulation`, and
  `contextmenu` on a word is prevented. Heart words can be marked.
- **Finish** calls `recordSession` (distinct marked words, today's local
  date), saves, and shows the session view. That view holds the story title,
  "N words marked:" plus plain chips (or "No words marked."), and "Last five
  sessions", oldest first, as date · title, a grey inline bar and a count. It
  has no praise, scores or stars. Marks are then cleared. "Back to the story"
  returns. Dots are **not** ticked automatically: the view says "If this was a
  full read-through, tick a dot under the story."
- **Dots** use `setReads`, with the prototype's toggle rule.
- **Grown-up panel** (inside the notes; the summary is now "How to run this,
  and step settings"). It holds the readiness text: "8 stories at step 2, 3
  reads each, stumbles down from 11 to 2", with the variants "up from",
  "steady at", "N stumbles in the one session so far", "Nothing read at step N
  yet." and "x.y reads each on average". Below that:
  - "Different story": `setCurrentStory(p, step, null)`, then `pickStory`,
    then `setCurrentStory` again. It is hidden when the pool has fewer than 2
    stories.
  - "Move to step N+1" with an **inline** confirm ("Move him to step N+1?" Yes,
    move / Cancel), because a `window.confirm` blocks CDP and is ugly on
    tablets. It is hidden at the last step.
  - A "Go back a step" link with the same inline confirm, hidden at step 1.
  Both use `promote` and then reload the new step's pool.
- **Saving.** Every change goes through `commit()`, which triggers a PUT
  debounced by 400 ms. A failure shows "Not saved — is the computer running?" in
  a `role=status` line **outside** the collapsed notes, just above them; I put
  it there so it cannot be missed. In-memory state is kept, and the next change
  retries. `pagehide` flushes a pending save with `keepalive`.
- **Kept from the prototype:** colour toggle (off by default), one line at a
  time with ←/→/space, the "How to run this" copy (plus a short "Marking
  stumbles" paragraph), the colour key, and the dark/light toggle. The theme
  choice is remembered per device in `localStorage` (inside try/catch), and the
  button label now follows the system scheme on first load.
- **Print CSS** hides the masthead tagline, theme button, step label, controls,
  hint, tray, notes, save note, session view and empty-pool box. Stumble and
  picked marks are dropped, lines are 26pt (measured 34.67px under print
  emulation) and the title is 22pt.
**`test/app-smoke.test.js`** has 7 tests on `createServer({root: REPO,
dataDir: temp})`, port 0:
- `/` is the app page.
- `index.html`, `app/*` and `lib/*` contain no `http(s)://`, no
  `//host.tld/` other than localhost, and no `@import`.
- every `src`/`href` in the page and both `@font-face` URLs are served, the
  fonts as `font/woff2`.
- every static import reachable from `app/app.js` resolves with 200 and a JS
  type (this follows lib's own imports too).
- `node --check app/app.js` succeeds.
- the data files and `/api/progress` are served, and progress starts at step 1.
- the app contains no `anthropic` and no `speechSynthesis`, and the page has
  no `<img/svg/canvas/video/audio>`.
**Verification (run by me):**
- `npm test`: **117/117 pass**.
- Headless Chromium screenshots, taken with `chromium-browser --headless` from
  a scratch server on 127.0.0.1:18090 with a temp dataDir at step 2. They are
  written under `~/s7shots/`, outside the repo: `main-1024.png` and
  `main-390.png` (CLI `--screenshot`), plus `tray-tap.png`, `colour-on.png`,
  `session.png`, `print-media.png`, `mobile-375-controls.png`,
  `macron-tray.png` and `poison-notes.png` (CDP). Headless defaulted to the
  dark scheme; the CDP shots emulate light.
- A CDP script (Node 22 `WebSocket`) confirmed these:
  - Tapping `Meg` gives `M·e·g` and `/m/ /e/ /g/ → Meg`, and a heart word
    gives the "Just tell him" copy.
  - The colour toggle sets `aria-pressed=true` and the `.marked` class.
  - A mark-mode tap plus a 700 ms mouse long-press marked `The` and `Meg`,
    and the long-press did not open the tray.
  - Finish recorded the session. The server's progress then held
    `stumbles {the:1, meg:1}`, `reads {s2-5e70:1}` and one session.
  - Pacing with ArrowRight shows "2 of 8".
  - At 375 px, `scrollWidth` = 375, so there is no horizontal scroll.
  - "Different story" switched Meg and the Red Hen to The Pup and the Bus,
    and `last_story` became `s2-5e70`.
  - Promote with confirm moved to step 3 and recorded
    `step_history [{step:2,to:3,promoted_at:"2026-09-20"}]`.
  - A PUT forced to reject showed "Not saved — is the computer running?".
    The server still had `reads {}` while the dot showed as ticked in memory.
    The next change saved and cleared the note.
- **Poison (acceptance 2):** the served dirs were copied to a temp root, and
  `through` was appended to line 2 of `s2-5e70`. `createServer({root: temp,
  dataDir: temp/data})` then ran with progress at step 2.
  - The pool file has 100 stories. 99 pass when the same modules are run in
    the page.
  - The app served a different first story ("The Pup and the Bus", not the
    poisoned pool[0]).
  - The app's console printed `Skipped story s2-5e70 "Meg and the Red Hen" at
    step 2: word not allowed: "through" (line 2)`.
  - The grown-up panel showed "1 story was skipped because it failed the
    word check."
- **Offline (acceptance 3):** `grep -nE 'https?://|//[a-z0-9-]+\.[a-z]{2,}'
  index.html app/* lib/*.js` found nothing (exit 1). In the CDP runs every
  request was `http://127.0.0.1:<port>/…`: the page, CSS, `app.js`, the five
  lib modules, both woff2, the two data files, the story pool, and GET/PUT
  `api/progress`. The non-local list was empty.
- **Macron:** `CSS.getPlatformFontsForNode` on `/ā/` (both `a`+U+0304 and
  precomposed U+0101) reports **Andika only, 4 glyphs**, so the latin woff2
  does carry the combining macron, and it looks right in `macron-tray.png`
  (`/j/ /ā/ /k/ → Jake`). The breve label `/ŏŏ/` (step 8+ `oo:short-oo`) is
  **not** fully in Andika: 2 glyphs come from Liberation Sans. See Found along
  the way. No fallback was needed for the macron.
- All scratch servers and headless browsers were stopped. The repo's `data/`
  has no `progress.json`.
**Deliberately left:**
- Dots are never ticked automatically.
- The story is chosen only at load, on "Different story" and on a step
  change. Ticking the third dot does not swap the story mid-session; the next
  load does.
- Pressing Finish twice records two sessions (a genuine re-read).
- There is no parent-gated "say it" button (the spec allows one, but it is not
  in the plan).
**Changes step 8:**
- The README should say that stumble marking is "Mark stumbles" or
  long-press, and that step changes live under "How to run this, and step
  settings".
- A save failure shows as a red line above that section.
- Steps 6–10 have no pools yet, so moving past step 5 shows the "run
  `npm run generate`" box. The README should point that out.

### [x] 8. LAN serving: docs and service unit
Files: `README.md`, `deploy/decodable-reader.service`.
- README: what it is (one paragraph, pointing at the spec), `npm install`,
  `npm start`, the LAN URL, how to find it on a tablet, `.env` for the key,
  `npm run generate -- --step N --count K`, `npm run validate`,
  `npm run check-bank`, and troubleshooting: if other devices can't connect,
  check `sudo ufw status` and `sudo ufw allow 8080/tcp`; the router's "client
  isolation" / guest network setting. Note that anyone on the wifi can change
  progress — there is no login.
- `deploy/decodable-reader.service`: a systemd **user** unit
  (`WorkingDirectory` = repo root, `ExecStart` = absolute node path + server.js,
  `Restart=on-failure`, `Environment=PORT=8080`). README says how to install it
  (`systemctl --user enable --now`, `loginctl enable-linger`). Do not install it.
Done when: README commands are accurate (run each non-interactive one).

**Done:** I edited only `README.md` (it replaces the stub) and the new
`deploy/decodable-reader.service`.
**README:** It is written for the parent and covers:
- a one-paragraph description pointing at `docs/build-spec.html`
- the quick start, and the LAN URL `http://<LAN IP>:8080/` (or whatever
  `npm start` prints, or `hostname -I`)
- opening it on a tablet and adding it to the home screen
- a pointer to the in-app daily routine
- stumbles ("Mark stumbles" or a long-press, then Finish)
- that step changes live only under "How to run this, and step settings"
- the red "Not saved" line
- the pools: 500 Claude-written stories, 100 for each of steps 1–5; steps 6–10
  have none and show the `npm run generate` box
- `.env` with `ANTHROPIC_API_KEY`, and `npm run generate -- --step N --count K`
  with `--max-attempts`, `--model` and `GEN_MODEL` (default
  `claude-sonnet-4-6`), as step 4 asked
- `npm test`, `npm run validate [-- --step N]` and `npm run check-bank`
- installing the user unit (`cp` to `~/.config/systemd/user/`, `daemon-reload`,
  `systemctl --user enable --now`, `loginctl enable-linger`), plus status,
  journal and removal commands
- troubleshooting: `sudo ufw status` / `sudo ufw allow 8080/tcp`, a guest
  network or router client/AP isolation, and a port in use (`PORT=8081 npm
  start`)
- that anyone on the wifi can change progress, because there is no login
**Unit:** it is a user unit, with these settings:
- `WorkingDirectory=<repo>`
- `ExecStart=/usr/bin/node …/server.js` (`command -v node` and `readlink -f`
  both give `/usr/bin/node`, v22.22.1)
- `Environment=PORT=8080` and `HOST=0.0.0.0`
- `Restart=on-failure`, `RestartSec=5`, after `network-online.target`
- `WantedBy=default.target`
The unit is **not installed or enabled**, and no systemctl or loginctl command
was run.
**Commands run and observed:**
- `systemd-analyze --user verify deploy/decodable-reader.service` exits 0. Its
  only output is a warning about the unrelated
  `/usr/lib/systemd/user/spice-vdagent.service:23`.
- `npm install`: "up to date, audited 8 packages", exit 0.
- `npm test`: 117/117 pass, exit 0.
- `npm run validate`: steps 1–5 each "100/100 stories pass", then
  "validate: ok", exit 0. `npm run validate -- --step 3` gives the same for
  step 3 alone.
- `npm run check-bank`: "ok — 922 entries …, 37 heart words", exit 0.
- `env -u ANTHROPIC_API_KEY npm run generate -- --step 6 --count 10`, with no
  `.env` present, prints the three-line missing-key message and exits 2. No
  `logs/` directory was created and no step-6 pool.
- `PORT=8097 npm start` logged `http://<LAN IP>:8097/` and
  `http://<tailscale IP>:8097/`. Curls to `http://<LAN IP>:8097/` gave:
  - `/` 200 `text/html`
  - `/api/progress` 200 with the default progress
  - `/stories/step-1.json` 200
  - `/stories/step-6.json` 404
  The server was then stopped, and the port is free. No `data/progress.json`
  was left, because only GETs were made.
**Deliberately left:** nothing needing sudo was run (the ufw commands are
documented only). The README's sample `npm start` output shows just the
192.168 line. The real output also lists the tailscale address, and the
tablet step tells the reader to use the `192.168…` one.

## Deferred (needs the user)

- **Acceptance 1** as written (100 *generated* stories per step with a logged
  API reject rate) needs `ANTHROPIC_API_KEY`. The user chose Claude-written
  pools instead (steps 5a–5e), which cover "zero validator failures in the
  served pool". `scripts/generate.js` stays built and tested with a fake
  client for when a key is added.

## Decisions the user made

- **The 60% distinct-word rule stays at 60% for every step** (asked 2026-09-20).
  The spec's own prototype stories and a naturally-written step-1 story fail it
  (~0.51). Do NOT relax it, and do NOT special-case a step. Stories at steps 1–2
  must therefore keep swapping nouns/verbs rather than repeating a subject, and
  the step-1 pool may end up well under 100 stories. Record the real count.
- **Story pools are written by Claude, not generated via an API** — no key, no
  API spend. `scripts/generate.js` is still built (step 4) for later.

## Found along the way

- Step 7: **the `/ŏŏ/` tray label is not in the vendored Andika subset.**
  Chromium draws 2 of its 4 glyphs from a system font (Liberation Sans here),
  so the breves may look mismatched. The step-6 note worried about the
  macron, but that renders fine in Andika. `/ŏŏ/` only appears for step-8+
  `oo:short-oo` words, and no pool exists for those steps yet. The fix is in
  `lib/segment.js` `SOUND_LABEL` (e.g. a plain `/oo/` with a word hint, or
  `/u/` as in *book*), or vendor a fuller Andika subset. I left it because it
  is outside step 7.
- Step 7: `pickStory` only rotates when the app loads or on "Different story".
  So a child who does all three reads in one sitting keeps the same story
  until the page is reloaded. This is fine for the intended one read a day.

- Step 6: **the fallback splitter mis-kinds the `e` in magic-e + `-s` words**
  (`makes rides homes`… 28 step-5 words, plus 3-letter `ate`). Appendix A
  only finds a word-final silent `e` in 4+-letter words. This is harmless while
  every served word is a bank word, because the bank path is used. It matters
  if the fallback ever runs on real input.
- Step 6: the step-7 print CSS and tray will render `/ā/` etc. with a combining
  macron (U+0304). Whether the vendored latin-subset Andika woff2 has that glyph
  was not verified; if it does not, the browser falls back per glyph.

- The Architecture section says `npm test` "runs `node --test test/`"; on
  Node 22.22 that fails with MODULE_NOT_FOUND. The script uses
  `node --test "test/*.test.js"` instead (step 1). The Architecture text was
  left as-is (outside step 1).
- Step 2: `ow` as in `cow` is graphemically identical to step 7's long-o `ow`;
  a text:kind check alone would have let `cow`/`down` in at step 7. check-bank
  now keys it off `sounds` (`ow:ou` only from the step adding `ou`). Any future
  sound-variant grapheme (e.g. a second `ea` sound) needs the same treatment.
- Step 2: `u_e` carries two sounds (cute /juː/ vs tune /uː/) and `th` two
  (this vs thin); neither is marked in steps 1–5 `sounds`. Harmless for
  segmentation display, but if the tray ever shows phonemes they need
  `sounds` entries.
- Step 4: the spec's prompt shape has no slot for "don't repeat what is already
  in the pool", so duplicate pressure is handled purely by rejecting after the
  fact. With a pool near 100 stories that will burn attempts. If a key is ever
  added and the reject rate is dominated by `duplicate_*`, the cheap fix is to
  list the existing titles in the prompt (a prompt change, not a rule change).
- Step 5e: **the banks list only some `-s` inflections.** `spot cut put pup
  bun lid lift grin swim pop plum twig dime grape plate…` are legal, but their
  `-s` forms are not, so a story can say "a pup" but not "the pups". This was
  the cause of 7 of the 8 `word` rejects in 5e, and the biggest class (~70) in
  its wanted-word tally. The fix would be a bank change: add the regular `-s`
  forms at the base word's step, or step 4 for CVC bases, with the voicing
  `sounds` step 2 already specifies. This was not done here (the plan forbids
  adding words to make a story pass). It needs its own step if the user wants it.
- Step 3: **four of the five prototype stories fail R3.** Run through
  `validateStory` (body lines only, ignoring their titles), the step-1, 2, 3 and
  4 stories are all `low_variety` (12/34, 21/39, 24/47, 24/45 distinct — the
  threshold is 60%), and the step-2 story also has a 10-word final line ("The
  fox and the pig had fun in the sun."). Only the step-5 story passes. Their
  words are all in the banks (step 2's test asserts that); it is the R3
  repetition rule they trip. So steps 5a–5e cannot "include the prototype's
  story for that step" unless it is edited — the plan already says "if it
  passes", so the honest reading is: rewrite or drop them, and do not loosen
  R3. Step 7's demo pool likewise needs stories that pass.

