# Decodable Reader

A small reading-practice app for a child who is learning to sound out words.
It shows short *decodable* stories: every word in a story can be sounded out
with the phonics taught so far, plus a short list of "heart words" that the
adult simply tells the child. The stories rotate, so the child keeps decoding
new text rather than reciting a story they have memorised.

It runs on one computer at home. Any tablet, phone or laptop on the same
network can open it in a browser, and they all share the same progress. It
needs no internet connection, no account and no build step. The server is a
single Node.js file.

The app's heading reads **Sound It Out**. The project and service are called
`decodable-reader`.

## Contents

- [Why it works this way](#why-it-works-this-way)
- [Features](#features)
- [Quick start](#quick-start)
- [Using it day to day](#using-it-day-to-day)
- [The phonics steps](#the-phonics-steps)
- [How the content works](#how-the-content-works)
- [Keeping it running](#keeping-it-running)
- [Project layout and architecture](#project-layout-and-architecture)
- [Development](#development)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Credits and license](#credits-and-license)

## Why it works this way

The whole design follows one rule from the build spec
([`docs/build-spec.html`](docs/build-spec.html)):

> Every content word in a generated story must be decodable using only the
> graphemes taught at or before the current step, plus an explicit list of
> heart words.

(A grapheme is a letter or group of letters that spells one sound, such as
`a`, `sh` or `ee`.)

A single untaught word (*beautiful*, *through*, *light*) breaks the exercise,
because the child then has to guess or be told the word. The adult can't
pre-read every story, so the software has to guarantee it:

- **Generate, then verify.** Stories are written from a fixed word bank. A
  deliberately strict validator then checks every word against the allowed
  list for that step. There is no stemming and no "close enough": if *digs*
  should be allowed, *digs* has to be in the bank. A story that fails is
  rejected as a whole and never shown. If the validator and whatever wrote
  the story disagree, the validator wins.
- **Checked on write and on read.** Stories are validated when they are added
  to a pool, and again by the app every time it loads them. A story that was
  edited by hand and no longer passes is skipped.

Some things are left out on purpose (spec §4):

| Not included | Why |
| --- | --- |
| Pictures of any kind | Pictures invite guessing from the image instead of reading the word. The plain page is the design. |
| Reading a whole word aloud on tap | It removes the effort the app exists to create. Tapping a word shows its sounds, not the answer. |
| Timers, scores, streaks, confetti | A struggling reader doesn't need to be told they were slow. |
| Automatic promotion to the next step | An adult decides when to move on. Moving a child forward on a metric before they are solid is the main way apps like this do harm. |
| "What happens next?" or picture-cue prompts | Same reason as pictures: they train guessing. |

The app is meant for about ten minutes a day of the child reading aloud to an
adult. After that the adult reads real books to the child. The app covers only
those first ten minutes.

## Features

- **Tap a word to see its sounds.** The sound tray splits the word into its
  letter groups, colours them by kind and spells out the sounds, for example
  `sh · i · p` and `/sh/ /i/ /p/ → ship`. In magic-e words the vowel shows its
  long sound and the silent *e* is greyed out with a one-line explanation.
- **Heart words.** Words that don't follow the rules yet (*the*, *said*,
  *was*, ...) are shown in purple and are never broken into sounds. Tapping
  one tells the adult to just say the word.
- **Warm-up strip.** A row of tappable words to practise before the story:
  words the child stumbled on in earlier sessions come first (up to 6), then
  words from the story that belong to the current step (at most 14 in all).
  Next to it is a "Know by heart" list of the heart words in today's story.
- **Colour the sounds.** Off by default, so the normal page is plain text.
  When it's on, vowels and vowel teams, two-letter consonant sounds and
  silent letters are coloured in the story. Heart words stay purple either
  way.
- **One line at a time.** Dims every line except the current one. Use the
  arrow buttons, or the arrow keys and space bar on a keyboard.
- **Three read-through dots.** The same story is meant to be read on three
  days. Tick a dot for each full read-through.
- **Stumble marking.** Turn on **Mark stumbles** and tap the words the child
  got stuck on, or long-press any word (half a second) at any time. Press
  **Finish** to save them. They come back in the warm-up on later days.
- **Session view.** After **Finish** there is one screen for the adult: the
  words marked this time, and the number marked in each of the last five
  sessions.
- **Manual step changes with a readiness hint.** Under **How to run this, and
  step settings** the adult can move to the next step or go back one (each
  asks for confirmation), or ask for a different story. A line such as
  "8 stories at step 2, 3 reads each, stumbles down from 11 to 2." helps
  decide.
- **Story rotation.** The app keeps serving the current story until it has
  three reads. Then it picks an unseen story, then the one with the fewest
  reads, then the one read longest ago. It never serves the same story twice
  in a row.
- **Print.** The browser's print view hides the controls and prints the story
  in large type.
- **Dark mode.** Follows the device setting. The **Dark**/**Light** button at
  the top overrides it, and each browser remembers its own choice.
- **Shared progress on your home network.** Progress is kept on the computer
  running the server, so every device sees the same place in the stories.
- **No internet needed.** The font (Andika) and all the data are served
  locally. Only the optional story generator talks to the internet.

## Quick start

You need **Node.js 22 or newer** (`node -v` to check) and a computer that stays
on while the app is in use.

```sh
git clone https://github.com/skareagle/SoundMeOut.git decodable-reader
cd decodable-reader
npm install
npm start
```

`npm install` fetches one direct dependency, the Anthropic SDK. Only the optional
story generator uses it. `npm start` prints the addresses it is listening on:

```
Decodable Reader listening on 0.0.0.0:8080
  http://<LAN IP>:8080/
```

On the same computer, `http://localhost:8080/` also works. On a tablet or
phone, open the `http://<LAN IP>:8080/` address it printed. If it prints more
than one, use the one on your home network (often `192.168.x.x` or
`10.x.x.x`). Adding the page to the home screen ("Share → Add to Home Screen"
on an iPad, "Add to Home screen" in Chrome on Android) makes it open like an
app.

Press Ctrl+C to stop the server. To keep it running in the background, see
[Keeping it running](#keeping-it-running).

Two environment variables change where it listens:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | TCP port |
| `HOST` | `0.0.0.0` | Address to bind. `0.0.0.0` means every network interface, so other devices can reach it. Use `127.0.0.1` to allow only this computer. |

```sh
PORT=8081 npm start
HOST=127.0.0.1 npm start
```

## Using it day to day

The app explains the routine itself. Open **How to run this, and step
settings** at the bottom of the page. In short:

1. Warm up on the word list until each word is quick.
2. Read the "Know by heart" words *to* the child, twice.
3. The child reads the story aloud. If they stall on a word for more than
   about three seconds, point at the first letter and say its sound, but not
   the word.
4. Read the same story again on the next two days, and tick a dot each time.

Start every new reader at **step 1**, even a confident one. An easy first
session costs ten minutes and is worth it.

Where things live on the page:

- **Mark stumbles**, **Finish**, **Colour the sounds**, **One line at a
  time**, **Print** and the read-through dots are in the row under the story.
- **Step settings** are under **How to run this, and step settings**:
  the readiness line, **Different story**, **Move to step N** and **Go back a
  step**. Moving on is always the adult's call.
- **"Not saved — is the computer running?"** appears in red above that
  section when a device couldn't reach the server. Nothing is lost on that
  device. It tries to save again on the next change once the server is back.
- **"Progress could not be loaded, so nothing will be saved."** means the
  page couldn't read progress when it opened. Nothing is saved from that page
  until you reload it, so a fresh start can't overwrite real progress.

The app's own wording was written for one particular child and says "him"
("Tell him the word", "Move him to step 3?"). If you want different wording,
see [Where the UI copy lives](#where-the-ui-copy-lives).

## The phonics steps

The progression is in [`data/scope-sequence.json`](data/scope-sequence.json).
Steps are cumulative: step 4 allows everything from steps 1–3 as well.

| Step | Name | New letters and letter groups | New word shapes | Heart words introduced | Bank words | Stories |
| --- | --- | --- | --- | --- | ---: | ---: |
| 1 | short a | a b c d f g h j k l m n p r s t v w y z | VC, CVC | the, a, is, has, his, as, and, to | 58 | 100 |
| 2 | all short vowels | e i o u x | none | i, of, put, go, no | 140 | 100 |
| 3 | digraphs | sh ch th ck wh ng nk qu ll ss ff zz | none | he, she, we, me, be, was, you, said, what, my, do, so | 138 | 100 |
| 4 | blends | none | CCVC, CVCC, CCVCC, CVC+s, CVC.CVC | from, they, are | 481 | 100 |
| 5 | magic e | a_e i_e o_e u_e | CVCe, CCVCe, CVCe+s | have, give, live, come, some, one, were, there, where | 183 | 100 |
| 6 | vowel teams I | ai ay ee ea | CVVC | none | 48 | none |
| 7 | vowel teams II | oa ow oo | none | none | 36 | none |
| 8 | r-controlled | ar or er ir ur | none | none | 37 | none |
| 9 | diphthongs | oi oy ou ow | none | none | 29 | none |
| 10 | common endings | ed es le | -ing, -ed, -es, C-le | none | 30 | none |

In total there are 1,180 bank words and 37 heart words (`npm run check-bank`
prints these counts). At step 2, `x` is taught as /ks/.

**Steps 1–5 have 100 stories each** (`stories/step-1.json` to
`stories/step-5.json`). **Steps 6–10 have word banks but no stories yet.** If
you move a child past step 5, the app shows "No stories for step 6 yet." and
tells you to run `npm run generate` for that step. See
[Adding stories](#adding-stories). The step 6–10 banks are much smaller than
the step 4 and 5 banks, so it's worth adding words before generating many
stories for them.

## How the content works

### Word banks

[`data/word-banks.json`](data/word-banks.json) holds one list per step. Each
entry is stored already split into its letter groups, rather than split by
code at runtime:

```json
{ "w": "ship", "g": [["sh","d"], ["i","v"], ["p","c"]], "step": 3 }
{ "w": "digs", "g": [["d","c"], ["i","v"], ["g","c"], ["s","c"]], "step": 4, "sounds": ["d","i","g","s:z"] }
{ "w": "bread", "g": [["b","c"], ["r","c"], ["ea","t"], ["d","c"]], "step": 6, "sounds": ["b","r","ea:short-e","d"] }
{ "w": "jack", "g": [["j","c"], ["a","v"], ["ck","d"]], "step": 3, "name": true }
```

- `w`: the word, lowercase.
- `g`: its letter groups, each with a kind: `c` consonant, `v` vowel,
  `d` two or more letters making one consonant sound (`sh`, `ck`, `ll`, `qu`,
  `ng`, and the step 10 endings `ed`, `es`, `le`), `s` silent, `t` vowel team
  (including r-controlled vowels and diphthongs). The groups must join back
  into the word.
- `sounds` (optional): one item per group, either the group's text or
  `"text:sound"` when the sound isn't the obvious one. It is required for the
  ambiguous groups `ea ow oo ou ed es` (`"ea:short-e"` in *bread*,
  `"ow:ou"` in *cow*).
- `name: true` marks a name, which the app shows with a capital (*Jack*).

Plural and verb `-s` endings follow one convention. They are added at step 4,
because they create a final consonant cluster, or at step 5 for magic-e words
(`bike` → `bikes`). Where the `s` says /z/ (*digs*, *rides*), the entry's
`sounds` ends in `"s:z"`. `-s` is never added after `s ss x z zz sh ch`,
because those need `-es`, which is step 10.

### Heart words

Heart words are listed per step in `data/scope-sequence.json` and are
cumulative. A word is either a bank word or a heart word, never both.
`npm run check-bank` enforces that.

### The validator

[`lib/validate.js`](lib/validate.js) is shared by the scripts and the browser.
For a story at step N, it splits each line (and the title) on whitespace,
strips punctuation, lowercases, and then requires every word to be in the step
1..N banks or the step 1..N heart words. The match is exact. A word with an
apostrophe must itself be in the lists. It also rejects a story that has:

- fewer than **5** lines,
- a line of more than **9** words,
- two lines with the same words,
- fewer distinct words than **60%** of its total words (this catches
  repetitive filler),
- a missing title, a token with digits or symbols, or a `step` that doesn't
  match its pool.

`npm run validate` checks every pool on disk. The app runs the same check when
it loads a pool. A failing story is skipped, noted in the browser console, and
reported in the step settings ("1 story was skipped because it failed the word
check.").

### Stories

Each pool is `stories/step-N.json`, shaped `{ "step": N, "stories": [...] }`.
One story looks like this (the example from the spec, shortened):

```json
{
  "id": "s3-0f2a",
  "step": 3,
  "title": "The fish and the ship",
  "lines": ["Jack has a red ship.", "..."],
  "words_used": ["the", "fish", "and", "ship", "jack", "has", "a", "red", "..."],
  "validated_at": "2026-09-20T10:04:00Z",
  "generator": "claude-sonnet-4-6"
}
```

The 500 stories that ship with the repo were **written by Claude (the Opus 5
model) directly, in a coding session, rather than through the API
generator**. Each one was checked with the validator before it was kept.
Their `generator` field says so: `"claude-opus-5 (hand-authored)"`.
`plans/decodable-reader.md` has the record of how they were written.

### Adding stories

You have two options.

**With the generator (needs an Anthropic API key).** The reading app never
calls the internet. Only this script does. Put your key in a file called
`.env` at the repository root. It is git-ignored, and the server never serves
it.

```sh
ANTHROPIC_API_KEY=sk-ant-...
```

Then:

```sh
npm run generate -- --step 6 --count 10
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--step N` | required | Which pool to add to |
| `--count K` | `1` | How many new stories to add |
| `--max-attempts N` | `5` | Model calls allowed per story before giving up on it |
| `--model ID` | `claude-sonnet-4-6` | Model to use. `GEN_MODEL` in `.env` or the environment also sets it, and `--model` takes precedence over it. |

For each story the script sends the full list of allowed words for the step,
plus 8–12 randomly chosen "focus" words from that step's own bank so the
stories vary. It validates the reply and also rejects near-duplicates (the
same title as an existing story, or half or more of its lines shared with
one). Each accepted story is appended to `stories/step-N.json` straight away.
Every rejected attempt is logged to `logs/rejects.jsonl`. At the end the
script prints the reject rate and the words the model most often reached for
that weren't allowed. That list is the best guide to what to add to the bank
next.

Without a key, the script stops and changes nothing:

```
generate: ANTHROPIC_API_KEY is not set.
  Put it in <repo>/.env as ANTHROPIC_API_KEY=sk-ant-... or export it in your shell.
  Nothing was generated; the reading app itself never needs a key.
```

The generator's parsing, validation, duplicate checks and logging are covered
by tests that use a fake API client. None of the shipped stories came from
it.

**By hand.** Add a story object to the right `stories/step-N.json` (give it a
unique `id` such as `s6-1a2b` and the pool's `step`), then run:

```sh
npm run validate -- --step 6
```

It prints each failing word or rule and exits non-zero if anything fails.

## Keeping it running

On Linux with systemd, you can install the server as a **user** service. It
then starts on its own (at boot, once lingering is enabled as below) and
restarts if it crashes.
[`deploy/decodable-reader.service`](deploy/decodable-reader.service) is a
template with two placeholders, `/path/to/decodable-reader` and
`/path/to/node`. Run this from the repository root to fill them in with the
current directory and your `node`, and install the result:

```sh
mkdir -p ~/.config/systemd/user
sed -e '/^#/b' -e "s|/path/to/decodable-reader|$PWD|g" -e "s|/path/to/node|$(command -v node)|g" deploy/decodable-reader.service > ~/.config/systemd/user/decodable-reader.service
systemctl --user daemon-reload
systemctl --user enable --now decodable-reader
loginctl enable-linger "$USER"    # keep it running when you're not logged in
```

(`-e '/^#/b'` leaves the comment lines at the top of the file unchanged.)
The unit sets `PORT=8080` and `HOST=0.0.0.0`. To change them, edit the
`Environment=` lines in the installed copy, then run
`systemctl --user daemon-reload` and
`systemctl --user restart decodable-reader`.

| Task | Command |
| --- | --- |
| Status | `systemctl --user status decodable-reader` |
| Logs | `journalctl --user -u decodable-reader` |
| Restart (after pulling changes) | `systemctl --user restart decodable-reader` |
| After moving the repo or Node | Run the `sed` line again, then `daemon-reload` and `restart` |
| Remove | `systemctl --user disable --now decodable-reader`, then delete `~/.config/systemd/user/decodable-reader.service` |

Stories and word banks are read fresh on each page load, so new stories only
need a browser reload, not a restart.

systemd isn't required. Any way of keeping `npm start` running works, such as
another process manager, a `tmux` session, or a login item on macOS.

## Project layout and architecture

```
server.js                   the web server: static files + /api/progress
index.html                  the reading app's page
app/app.js                  the reading app (browser ES module)
app/style.css               styles, including dark mode and print
lib/bank.js                 word banks, heart words, allowed-word sets
lib/validate.js             the story validator
lib/segment.js              splits words into letter groups and sounds for the tray
lib/rotation.js             chooses which story to serve next
lib/progress.js             progress model: reads, stumbles, sessions, warm-up, readiness
lib/prompt.js               builds the generation prompt
scripts/generate.js         npm run generate: API generator
scripts/validate.js         npm run validate: checks the story pools
scripts/check-bank.js       npm run check-bank: checks the word banks
data/scope-sequence.json    the ten phonics steps
data/word-banks.json        pre-segmented word banks, one list per step
data/progress.json          progress (created on first save; git-ignored)
stories/step-1.json ...     story pools, steps 1–5
fonts/                      Andika (regular and bold woff2) and its licence, OFL.txt
deploy/decodable-reader.service   systemd user unit template
docs/build-spec.html        the design spec
docs/prototype.html         the original single-file UI prototype
plans/                      the build record, one file per task
test/                       node:test suites
```

How it fits together:

- **The server** (`server.js`) uses only Node's built-in `http` module. It
  serves `index.html` and the files under `app/`, `lib/`, `data/`,
  `stories/` and `fonts/`, and returns 404 for everything else (`scripts/`,
  `plans/`, `node_modules/`, `.env`, dotfiles). `data/progress.json` is
  reachable only through the API.
- **`/api/progress`**: `GET` returns the progress object, and `PUT` replaces
  it. The server normalises whatever it receives, writes the file atomically,
  and falls back to a fresh start at step 1 if the file is missing or
  corrupt. Bodies are limited to 256 KB.
- **The browser does the rest.** The modules in `lib/` have no Node-only
  imports, so the browser and the Node scripts and tests run the same
  validator, segmenter and rotation code. The app loads the scope, banks and
  the current step's pool, validates the pool, picks a story, and saves
  progress back with `PUT` (debounced, and flushed when the page closes).

## Development

```sh
npm test                        # all test suites (node:test)
npm run validate                # re-check every story pool
npm run validate -- --step 3    # one pool
npm run check-bank              # check the word banks against the scope sequence
```

`validate` and `check-bank` print the problems and exit non-zero if anything
fails. There is no build step. Edit a file and reload the page.

### Adding words

Add entries to the right step in `data/word-banks.json`, then run
`npm run check-bank`. It checks that:

- `w` is lowercase a–z, and the entry's `step` matches the list it's in;
- the groups in `g` join to `w`, use the kinds `c v d s t`, and are all
  taught at or before that step;
- at steps 1–3 a word has exactly one vowel group and no two consonant groups
  side by side (blends start at step 4);
- `sounds`, if present, has one item per group. It is required for
  `ea ow oo ou ed es`. `"s:z"` appears only from step 4, and `"ow:ou"` (as in
  *cow*) only from step 9;
- no word appears twice, and no bank word is also a heart word.

Then run `npm run validate`, because removing or moving a word can break
existing stories.

### Adding or changing a step

Edit `data/scope-sequence.json`. Step `id`s must run 1, 2, 3 and so on in
order. The app offers steps up to the highest one. Any new multi-letter
letter group has to be added to `GRAPHEME_KIND` in `lib/bank.js`, or
`check-bank` will reject it. If it can make more than one sound, also add it
to `AMBIGUOUS` in `lib/bank.js` and give its sound labels in `SOUND_LABEL` in
`lib/segment.js`.

### Where the UI copy lives

- `index.html`: the fixed text, including the routine, "What not to do", the
  colour key and the button labels.
- `app/app.js`: text built at runtime, including the sound tray ("A heart
  word. Just tell him: ..."), the readiness line, the step-change
  confirmations, the session view, the empty-pool box and the save messages.
- `lib/prompt.js`: the generation prompt.

## Security and privacy

- **It is meant for a home network only. There is no login.** Anyone who can
  reach the port can read and change progress, including moving the child to
  another step or resetting it. Don't expose it to the internet or forward
  the port on your router. Use `HOST=127.0.0.1` if only this computer should
  reach it.
- **Progress stays on your computer**, in `data/progress.json`, which is
  git-ignored. It holds the current step, reads per story, stumble counts and
  the last 60 sessions (date, story and marked words). The only other thing
  stored is the theme choice, kept in each browser's local storage.
- **Nothing is sent anywhere by the app.** Only `npm run generate` makes
  network requests, to the Anthropic API, using your key.
- The API key lives in `.env`, which is git-ignored and never served.

## Troubleshooting

- **It works on the computer but not on the tablet.** A firewall is the usual
  cause. On Ubuntu, check with `sudo ufw status`. If it's active, run
  `sudo ufw allow 8080/tcp` (or your `PORT`).
- **Still can't connect.** Make sure the tablet isn't on a guest network.
  Also check whether the router has "client isolation" (sometimes called "AP
  isolation") turned on. Either one stops devices on the network from seeing
  each other. Also make sure you used the address `npm start` printed, not
  `localhost`, which on the tablet means the tablet itself.
- **"address already in use" / the port is taken.** Pick another port:
  `PORT=8081 npm start`, then open `http://<LAN IP>:8081/`. The firewall rule
  needs the same port. For the service, change `Environment=PORT=` in the
  installed unit.
- **"No stories for step N yet."** The step has no pool file, or none of its
  stories passed the word check. Add stories (see
  [Adding stories](#adding-stories)), or use **Go back a step**.
- **"Could not load the word lists — is the computer running?"** The page
  couldn't reach the server. Check that it is running, then reload.
- **Progress looks wrong.** Progress lives in `data/progress.json`. If that
  file is missing or unreadable, the app starts fresh at step 1 and doesn't
  crash. Before editing the file by hand, close the app on every device,
  because an open page saves its own copy on the next change.

## Credits and license

- **Code:** MIT. See [`LICENSE`](LICENSE).
- **Font:** [Andika](https://software.sil.org/andika/) by SIL International,
  designed for people learning to read (it has a single-storey *a* and *g*).
  It is included in `fonts/` under the SIL Open Font License 1.1. See
  [`fonts/OFL.txt`](fonts/OFL.txt). The MIT license does not cover it.
- **Design:** the build spec is [`docs/build-spec.html`](docs/build-spec.html),
  and the original UI prototype is [`docs/prototype.html`](docs/prototype.html).
- **Build record:** [`plans/`](plans/INDEX.md) holds the plan and notes for
  each piece of work, including how the word banks and stories were made.
- The 500 stories were written by Claude, and the code was built with Claude
  Code.
