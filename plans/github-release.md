# github-release — make the repo shareable on GitHub, with a detailed README

Status: done

## Goal

The user was asked to put this project on GitHub to share it. Make the repo
fit for a public audience: a detailed README written for a stranger who clones
it, no personal information about the user's child or machine, an MIT license,
and (last, done by the main agent) a single fresh commit so old history with
personal details doesn't ship. **Nothing is pushed** — the user does that.

## Decisions the user made (2026-09-22)

- **Remove the child's details.** `docs/build-spec.html` §6 ("Notes on the child
  this is for") gave the child's reading-level score, grade and standing.
  Replace it with a generic note; keep the useful guidance (10 minutes a day, start at step 1,
  the app covers only decoding practice, not the read-aloud time after).
- **Fresh history + MIT.** Squash to one initial commit (main agent, final
  step). Add an MIT `LICENSE` for the code, copyright holder the user's
  configured git name (first name and initial, as written in `LICENSE`), year
  2026. The Andika font keeps its own SIL
  OFL (`fonts/OFL.txt`) — the README must say so.

## Rules this task must hold

- Don't change app behaviour. Allowed code-adjacent changes are only: the
  `license` field in `package.json`, and turning the systemd unit into a
  template. `npm test` must still pass 118/118 and `npm run validate` 500/500.
- The app's own copy ("tell him the word") is the prototype's wording for the
  child it was built for; **leave the app copy alone**. The README may say the
  copy assumes a boy and point to where it lives, for anyone adapting it.
- The build spec is the design contract; don't rewrite it beyond §6. Other
  personal specifics (the machine's LAN IP, home-directory paths, Claude
  scratchpad paths under `/tmp`) should be generalised in
  every tracked file (`git ls-files`), with one exception: the plan files'
  history of *what happened* stays — just replace the paths/IP inside them
  with neutral forms (`<repo>`, `<scratchpad>`, `<LAN IP>`).
- A systemd user service installed from this repo is live on this machine
  (`~/.config/systemd/user/decodable-reader.service`, a copy). Don't touch the
  installed copy, systemctl, or the running server.

## Steps

### [x] 1. Scrub personal details, license, unit template
Files: `docs/build-spec.html` (§6 only), `plans/decodable-reader.md`,
`plans/bank-inflections.md`, `plans/INDEX.md` (only if they contain the
specifics above), `deploy/decodable-reader.service`, `LICENSE` (new),
`package.json` (`"license": "MIT"` only), and this plan's notes.
- §6 → a short generic section (title can stay "Notes on the reader this is
  for"): early reader, practice not remediation, start at step 1, ~10 minutes
  a day aloud to an adult followed by the adult reading real books; the app
  covers only the first ten minutes.
- Generalise IP/paths per the rules. Grep afterwards over `git ls-files` for
  the LAN IP, the home path, the user's name, the reading-level terms from
  the old §6 and the local parts of the user's email addresses — expect zero
  hits outside `LICENSE`'s copyright line. (The literal patterns are kept
  out of the repo, in `.git/info/scrub-patterns`; see step 1's **Done**.)
- The unit: replace the absolute paths with clear placeholders
  (`/path/to/decodable-reader`, `/path/to/node`) and a comment giving the
  one-liner that fills them in on install, e.g.
  `sed -e "s|/path/to/decodable-reader|$PWD|" -e "s|/path/to/node|$(command -v node)|" deploy/decodable-reader.service > ~/.config/systemd/user/decodable-reader.service`.
  Verify the filled-in result with `systemd-analyze --user verify` on a temp
  copy (not in `~/.config`).
Done when: the grep is clean; `npm test` and `npm run validate` pass; the
filled-in unit verifies.

**Done:** completed across two attempts. The first was stopped partway and
left uncommitted edits. The second reviewed them, kept them all, and finished
the step.
- `LICENSE` (new): the standard MIT text, `Copyright (c) 2026` plus the
  user's git name. `package.json`: only `"license": "MIT"` was added (it keeps
  `"private": true`).
- `docs/build-spec.html` §6 is now "Notes on the reader this is for": an
  early reader learning to decode; practice, not remediation; start every new
  reader at step 1; about ten minutes a day aloud to an adult, then about
  twenty minutes of the adult reading real books; the app covers only the
  first ten minutes. Nothing else in the spec changed.
- `plans/decodable-reader.md`: the LAN IP became `<LAN IP>`, the tailscale IP
  became "a tailscale address" / `<tailscale IP>`, the repo path became
  `<repo>`, and the scratch path became `<scratchpad>/`. The record is
  otherwise unchanged. `plans/bank-inflections.md` and `plans/INDEX.md` had
  no hits and were not edited. This plan's own text was also reworded so it
  no longer holds the literal IP, paths, reading-level terms or email local
  parts.
- The grep patterns (LAN IP prefix, tailscale prefix, home path, Claude scratch path,
  the user's name, the three reading-level terms, the two email local parts)
  live in `.git/info/scrub-patterns`. That file is local and never
  committed or pushed. The check for step 3 is:
  `{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | xargs grep -nIiE -f .git/info/scrub-patterns`.
  Current output: `LICENSE:3` (the copyright line) plus four `README.md`
  lines (25, 33, 102, 126), which step 2 must remove (see Found along the
  way). A wider sweep for any email address or dotted IP found only those
  README lines and generic `0.0.0.0`/`127.0.0.1`.
- `deploy/decodable-reader.service` is now a template:
  `WorkingDirectory=/path/to/decodable-reader` and
  `ExecStart=/path/to/node /path/to/decodable-reader/server.js`. The header
  comment gives the install steps. **The exact install one-liner for the
  README** (run from the repository root, after
  `mkdir -p ~/.config/systemd/user`):
  `sed -e '/^#/b' -e "s|/path/to/decodable-reader|$PWD|g" -e "s|/path/to/node|$(command -v node)|g" deploy/decodable-reader.service > ~/.config/systemd/user/decodable-reader.service`
  (`/^#/b` leaves the comment lines' placeholders alone). After that:
  `systemctl --user daemon-reload`,
  `systemctl --user enable --now decodable-reader`,
  `loginctl enable-linger "$USER"`. To move the repo or Node, rerun the sed,
  then daemon-reload and `systemctl --user restart decodable-reader`.
- Verified: the one-liner wrote a filled-in copy into the scratchpad (not
  `~/.config`). `systemd-analyze --user verify` on it exited 0. Its only
  output was a warning about an unrelated system unit
  (`spice-vdagent.service`). The copy's non-comment lines are identical to
  the installed live unit (read-only `diff`). The live service, systemctl
  and port 8080 were not touched. `npm test`: 118 tests, 118 pass, 0 fail.
  `npm run validate`: steps 1–5 each 100/100, `validate: ok`.
- For step 2: the README must contain none of the patterns. Use
  `http://<LAN IP>:8080/`-style or "the address `npm start` prints" wording.
  The README must also explain the unit template and the sed one-liner above
  (the current README still says to edit hard-coded paths). Nothing was
  committed.

### [x] 2. Detailed README
Files: `README.md` only (and this plan's notes).
Audience: someone on GitHub — a parent, teacher or developer — who has never
seen the project. Detailed but scannable. It must be accurate to the code
(read the code, don't guess), and must not promise anything the app doesn't
do. Cover, in roughly this order:
1. What it is and why: decodable stories that rotate so the child sounds out
   rather than memorises; the one rule (every word decodable at the current
   step, generate-then-verify, validator wins); what it deliberately does NOT
   do (no pictures, no whole-word read-aloud, no timers/scores/streaks, no
   automatic promotion) and why — from the spec §4.
2. Features, concretely (tap-a-word sound breakdown, heart words, warm-up,
   colour-the-sounds, one line at a time, three read-through dots, stumble
   marking + next-day warm-up, parent session view, manual step changes with a
   readiness hint, print, dark mode, works on a home network with shared
   progress, no internet needed).
3. Quick start (Node ≥ 22, `npm install`, `npm start`, open the printed LAN
   URL; `PORT`/`HOST` env).
4. Using it day to day (the routine; where stumbles/step settings live; the
   "Not saved" line).
5. Phonics scope: a table of steps 1–10 from `data/scope-sequence.json`
   (name, what it adds, heart words introduced), and which steps currently
   have story pools (1–5, 100 each) vs word banks only (6–10).
6. How the content works: word banks (pre-segmented entries, kinds, `sounds`,
   the -s/`s:z` convention), heart words, the validator's rules (exact match,
   ≥5 lines, ≤9 words/line, no duplicate lines, ≥60% distinct words), validate
   on write AND on read (a bad story is skipped and flagged in the app).
   Where the 500 stories came from (hand-authored by Claude, each validated;
   `generator` field) and how to add more: `.env` + `npm run generate`
   (default model, flags, reject log), or hand-write + `npm run validate`.
7. Keeping it running: the systemd user unit (with the sed install one-liner
   from step 1, `enable --now`, `enable-linger`, status/logs/remove);
   brief note that any always-on process manager works.
8. Project layout (tree with one line each) and architecture (static Node
   server + `/api/progress`; `lib/` modules shared by browser and Node).
9. Development: `npm test`, `npm run check-bank`, `npm run validate`; how to
   add a step or words (check-bank rules); where the UI copy lives.
10. Security/privacy: LAN only, no auth — anyone on the network can change
    progress; don't expose it to the internet; progress stored in
    `data/progress.json` (git-ignored).
11. Troubleshooting (firewall/ufw, client isolation, port in use, "no stories
    for this step").
12. Credits & license: MIT for code; Andika © SIL, OFL; design spec in
    `docs/build-spec.html`, UI prototype in `docs/prototype.html`, build record
    in `plans/`.
No screenshots are required (none exist in the repo); do not reference image
files that don't exist.
Done when: every command in the README has been run (non-sudo, not touching
the live service) and behaves as described; every file path it names exists;
the step table matches `data/scope-sequence.json`.

**Done:** `README.md` was rewritten from scratch. No other tracked file was
changed.
- Sections: intro; Contents; Why it works this way (the spec §1 rule quoted
  exactly, generate-then-verify, validate on write and read, a table of what
  is left out and why, from §4, plus the ten-minutes note from §6); Features;
  Quick start (Node ≥ 22, clone/install/start, the printed address shown as
  `http://<LAN IP>:8080/`, `PORT`/`HOST` table); Using it day to day (the
  routine, where controls live, the "Not saved" and "Progress could not be
  loaded" lines, a note that the copy says "him", with a pointer to where it
  lives); The phonics steps (table: step, name, graphemes_added,
  structures_added, heart words, bank size, story count); How the content
  works (bank entry format and kinds, `sounds`, the -s/`s:z` convention,
  heart words, validator rules 5 / 9 / duplicates / 60%, validate on read,
  story shape, the 500 stories being hand-authored by Claude with
  `generator: "claude-opus-5 (hand-authored)"`, Adding stories with
  `.env` + `npm run generate` (options table, default `claude-sonnet-4-6`,
  focus words, near-duplicate rejection, `logs/rejects.jsonl`, the no-key
  message) or by hand + `npm run validate -- --step N`); Keeping it running
  (step 1's sed one-liner verbatim, daemon-reload, `enable --now`,
  `enable-linger`, a status/logs/restart/move/remove table, and a note that
  any process manager works); Project layout and architecture; Development
  (commands, check-bank's rules, adding a step via `GRAPHEME_KIND` /
  `AMBIGUOUS` / `SOUND_LABEL`, where the UI copy lives); Security and
  privacy; Troubleshooting; Credits and license (MIT, Andika under the SIL
  OFL in `fonts/OFL.txt`, spec, prototype, `plans/`).
- Facts taken from the code: defaults `HOST=0.0.0.0` and `PORT=8080`, served
  dirs and 404s, and the 256 KB body limit (`server.js`); warm-up up to
  6 stumbles and 14 words, 60 kept sessions, the readiness wording
  (`lib/progress.js`, `app/app.js`); rotation order (`lib/rotation.js`); the
  500 ms long-press, button and message text (`index.html`, `app/app.js`);
  validator thresholds (`lib/validate.js`); 8–12 focus words
  (`lib/prompt.js`); generator defaults and flags (`scripts/generate.js`);
  check-bank rules (`scripts/check-bank.js`). Generator values were counted
  in the pools: all 500 are `claude-opus-5 (hand-authored)`.
- Verified by running (Node v22.22.1): `npm install` ("up to date, audited
  8 packages", 0 vulnerabilities); `npm test` (118 tests, 118 pass,
  0 fail); `npm run validate` (steps 1–5 each 100/100, `validate: ok`);
  `npm run validate -- --step 3` (100/100, ok); `npm run check-bank`
  (`ok — 1180 entries (1:58 2:140 3:138 4:481 5:183 6:48 7:36 8:37 9:29
  10:30), 37 heart words`, the numbers used in the table);
  `npm run generate -- --step 6 --count 10` with no key (the three-line
  refusal quoted in the README with the path as `<repo>`, exit 2; no `.env`
  or `logs/` was created). `PORT=18099 npm start` printed
  `listening on 0.0.0.0:18099` plus LAN URLs. curl: `/`, `/api/progress`,
  a font and `stories/step-1.json` returned 200. `/.env`,
  `/scripts/generate.js` and `/data/progress.json` returned 404. The process
  was stopped by PID. `HOST=127.0.0.1 PORT=18099 node server.js` printed
  `listening on 127.0.0.1:18099` / `http://127.0.0.1:18099/` and was stopped
  by PID. Port 8080 still answered 200 afterwards and was not touched.
- The README's sed line (taken from the README text, with only the output
  path redirected to the scratchpad) produced a unit with the repo path and
  `/usr/bin/node` in `WorkingDirectory`/`ExecStart`. `/path/to` was left only
  in the two comment lines. `systemd-analyze --user verify` exited 0, and its
  only output was the unrelated `spice-vdagent.service` warning.
  systemctl, loginctl and `~/.config` were not touched.
- A script compared the README step table with `data/scope-sequence.json`,
  the bank sizes and the pool sizes: 10 rows, 0 mismatches. A script checked
  every repo path the README names: all exist, apart from `/api/progress`
  (a URL route) and `stories/step-N.json` (a placeholder).
  `grep -nIiE -f .git/info/scrub-patterns README.md` printed nothing. A sweep
  for dotted IPs found only `0.0.0.0` and `127.0.0.1`.
- Left: no screenshots, badges or repo URL (the clone line says
  `<this repository's URL>`). The Credits line "the code was built with
  Claude Code" rests on the build record, not on the code.

### [x] 3. Fresh history (main agent)
Main agent only: confirm the working tree is clean and the step-1 grep is
clean, then replace history with a single initial commit using the user's own
git identity (no `-c user.*` overrides), keeping a backup ref of the old
history locally (`backup/pre-release`) so nothing is lost. Do not push, and do
not add a remote.

**Done (main agent):** before squashing, synced `package-lock.json` (`npm
install` adds `"license": "MIT"`, flagged by step 2) so a fresh clone's
install doesn't modify a tracked file. **Changed from the plan:** the backup
of the old history is a git bundle *outside* the repository
(`~/decodable-reader-pre-release.bundle`), not a `backup/pre-release` branch
— a local branch still holds the child's old details and would be published
by an accidental `git push --all`. Verified the scrub grep over all tracked
and untracked files (only the LICENSE copyright line), `npm test` and
`npm run validate`, then replaced `main` with a single root commit authored
with the user's own git identity (no overrides). No remote was added and
nothing was pushed.

## Found along the way

- (step 2) `npm install` adds `"license": "MIT"` to `package-lock.json`,
  because step 1 added it to `package.json` and the lockfile wasn't synced.
  Step 2 may edit only `README.md`, so the change was reverted with
  `git checkout -- package-lock.json`. Before step 3's commit, the main agent
  should run `npm install` and keep that one-line lockfile change. Otherwise
  every fresh clone's `npm install` will change a tracked file.
- (step 2) `index.html`'s closing note uses reading-level range terms. These
  are generic scale names, not the child's data, and they are app copy, so
  they were left alone. They are not in the README.

- `README.md` (step 2's file, not edited in step 1) still has the LAN IP on
  lines 25, 33 and 126, and the home-directory repo path on line 102.
  Step 2's rewrite must remove them.
- `lib/prompt.js`, `docs/build-spec.html` (its prompt template) and `test/generate.test.js`
  say "a 6-year-old" in the generation prompt. This is generic, not the
  child's data, and it is app behaviour and the design contract, so it was
  left alone.
