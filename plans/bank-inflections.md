# bank-inflections — add the missing plurals and -s verbs to the word banks

Status: done

## Goal

The step-1–5 word banks contain only some `-s` forms: "a pup" is legal but
"the pups" is not, and `cuts`, `lifts`, `bites`, `plates` are missing. While
writing the step-5 pool this was the most-wanted class of word (~70 misses; see
`plans/decodable-reader.md`, Done (5e) and Found along the way). The user asked
to add them. This is a **bank-only** change: no story, validator, app or server
code changes.

Read `plans/decodable-reader.md` first (rules R1, R7, and step 2's Done notes,
which define the bank's conventions) and `docs/build-spec.html` §1–2.

## Rules this task must hold

- **R1 Decodability (from the build spec, non-negotiable).** Every new entry
  must decode with graphemes taught at or before its `step`. Correctness beats
  size: one wrong entry lets an undecodable word reach a child. When unsure,
  leave the word out and list it.
- **Existing conventions (step 2 of decodable-reader), unchanged:**
  - Added `-s` endings go at **step 4** (they make a final consonant cluster),
    or at **step 5** for magic-e stems (`bike` → `bikes`). Never earlier.
    Formula: `step = 5` if the stem has a silent-e, else `max(4, stem step)`.
  - `-s` is **never** added after `s ss x z zz sh ch` — those need `-es`,
    which is step 10.
  - Where the `s` says /z/ (after a voiced sound: vowel, `b d g l m n ng r v`,
    `ll`, magic-e stems ending in a voiced consonant), the entry has `sounds`
    ending in `"s:z"`, in the same format as the existing entries (`digs`,
    `rides`). After `p t k ck f ff th`-voiceless, it says /s/ and has no `s:z`.
  - Entry shape as existing ones: `{"w","g":[[text,kind],...],"step"}` plus
    `sounds` only where needed; final `s` is kind `c`.
- **Only real, useful forms of existing bank words.** The stem must already be
  a bank word at steps 1–5. Include: plural nouns (`pups`, `lids`, `plates`),
  third-person verbs (`cuts`, `lifts`, `bites`). Exclude: names, function
  words and adjectives (`its`-type forms that already exist excepted —
  don't add `bigs`, `reds`, `nots`, `ups`), mass nouns where the plural is odd
  for a six-year-old (`muds`), stems that are heart words (`puts`, `comes`,
  `gives` — `put`/`come`/`give` are hearts, not bank words), and anything
  already present.
- **No word at two steps; no word that is also a heart word** (`is has his as`
  are hearts). `npm run check-bank` enforces both.
- **Existing stories must still pass.** Adding words can only widen the allowed
  set, but check anyway: `npm run validate` over all five pools.

## Steps

### [x] 1. Add the -s forms
Files: `data/word-banks.json`, `test/segment.test.js` (only the pinned
fallback-difference list in the test "the fallback agrees with the bank for
steps 1–5 except magic-e + s and 3-letter magic e"), `test/bank.test.js`
(add one test), and this plan's notes. Nothing else.
- Build the candidate list mechanically (a scratch script in your scratchpad,
  not in the repo): for every step-1–5 bank entry, derive `w + "s"`, its `g`
  (stem's `g` + `["s","c"]`), `step` by the formula, and `sounds` by the
  voicing rule. Drop the `-es` stems, names, and anything already in any bank
  or heart list.
- Then **decide by hand, word by word,** which are real, useful noun plurals
  or verb forms for a six-year-old, per the rules. Keep a written list of the
  excluded stems with a one-word reason (`adjective`, `function`, `mass`,
  `odd`, …) — it goes in the Done notes.
- Insert each new entry in its step's array (keep the file's existing
  formatting style; sorting within a step is not required).
- Update the pinned difference list in `test/segment.test.js` so it expects
  the new magic-e + s words too; it must not stop pinning anything it pinned
  before.
- Add a test in `test/bank.test.js` that every step-1–5 bank word `w` that is
  a noun/verb stem you included has its `ws` form allowed at the expected
  step — simplest form: a hard-coded sample of 15–20 of the new words (mix of
  /s/ and /z/, step 4 and step 5) asserting their step and `s:z` marking,
  plus `pups`, `lids`, `plums`, `twigs`, `cuts`, `lifts`, `bites`, `plates`,
  `grapes`, `dimes` (the words the step-5 writer missed, where the stem is in
  the bank).
Done when: `npm run check-bank` exits 0; `npm test` passes; `npm run validate`
still shows 100/100 for steps 1–5. Report: count added per step, the full
list of added words grouped by step and by /s/ vs /z/, and the excluded
stems with reasons.

**Done:** **258 entries added: 214 at step 4 (120 /s/, 94 /z/), 44 at step 5
(16 /s/, 28 /z/).** Banks now 4:481, 5:183, 1180 in all (was 922).
Method: a scratch script (session scratchpad, not the repo) took every
step-1–5 entry, formed `w+"s"` with `g` = stem `g` + `["s","c"]`, `step` = 5
for a silent-e stem else `max(4, stem step)`, and `sounds` (stem texts +
`"s:z"`) when the sound before the `s` is voiced (`b d g l ll m n ng r v`).
It dropped mechanically 333 stems: 41 names, 113 whose `-s` form is already a
bank word, 179 that end in a sibilant or `s` (`s ss x zz sh ch`, silent-e
stems on `s z`, e.g. `nose rose prize chase`, and every existing `-s` word).
None of the 409 remaining forms was a heart word. I then went through the 409
by hand: **258 kept, 151 stems excluded** (stems, by reason):
- *function* (24): `at am an in on up if not but him yet that then them with
  when off just next past himself itself while must`
- *adjective* (36): `fat bad mad sad big red wet dim hot thin thick sick quick
  pink long fast best glad snug flat strong damp soft safe cute late same fine
  wide white brave tame pale ripe still upset`
- *past* tense (42): `sat had ran got did fed led met hid lit dug shot sang
  rang sung hung sank sunk fell stuck slid swam sped spun fled bent felt held
  kept left lost sent went rode came made gave ate woke broke spoke drove`
- *mass* (20): `mud fun fog gum luck ink junk math sand milk fluff frost dust
  mist rust silk dusk catnip pride smoke`
- *irregular* plural (5): `man men elf self shelf` (men/elves/selves/shelves)
- *odd* for a six-year-old (21): `vat tan sap ten bid rid mob sun yum yuck
  back will chill shock thrill risk nine five lad jig west`
- *th-voicing* doubtful (3): `bath path moth` (`baths paths moths` are said
  both /θs/ and /ðz/; left out rather than guess)
Kept, step 4 /s/ (120): `mats pats caps taps laps gaps zaps yaps yaks jets
nets vets bets dips hips lips tips bits fits kits pits pops cots dots lots rots
pups cuts huts shops shuts chips chops chats checks chicks whips sacks racks
decks necks pecks ticks locks docks tucks quits quacks sinks banks tanks thanks
bunks chunks huffs cuffs spots spits stacks sticks stamps snacks snips skips
skunks smacks bricks crops cliffs clocks clucks drips drinks flaps flips flops
grips grunts plots plops prints splits straps strips traps tricks trucks trunks
belts camps gifts gusts helps hunts lamps lifts lists lumps masks pants rafts
rests tests tusks vests desks tasks yelps gulps melts chests chimps chomps
thumps stomps sunsets picnics laptops hilltops insects chipmunks`.
Step 4 /z/ (94): `rags tags wags sags cabs jabs tabs dabs labs dads pads hams
jams yams rams dams cans vans pals dens begs pegs webs figs wigs ribs bibs lids
rims bins fins pins tins jobs robs sobs pods rods hogs jogs logs moms cubs buds
jugs mugs rugs hums sums buns sheds shells shins chins chugs thuds bangs hangs
songs lungs wells pills clams stands stems sleds slams slugs swims skins skids
smells spells brings cribs clubs grins plums scrubs strings twigs twins bends
bands lands lends mends ponds swings stings bathtubs zigzags napkins`.
Step 5 /s/ (16): `bakes takes wakes gates tapes capes dates hikes wipes bites
stripes jokes pokes flutes grapes plates`. Step 5 /z/ (28): `manes pines saves
caves lanes canes dimes miles piles sides tides shines spines drives hives vines
poles stones stoves globes cubes mules tunes planes shades cranes flames
whales`. New entries were appended to the end of the step-4 and step-5 arrays,
one per line in the file's existing style.
Of the 5e writer's misses, all whose stem is a bank word are now in
(`spots cuts lifts pops hums grins swims swings bites takes bakes tapes tips
taps drips stacks helps pups buns lids plums twigs dimes grapes plates vans jugs
tins dots bits pals`); `puts comes gives` (heart stems), `rolls holds adds
walks` (stems in no bank) and `looks says plays stays` (stems at steps 6–7,
outside this task's steps 1–5) stay out.
**Tests:** the segment test "the fallback agrees with the bank … except magic-e
+ s" was not a hard-coded list but a shape rule, which already admits the new
magic-e + s words; I kept that rule unchanged and added to it: it now also
asserts that every step-1–5 magic-e + s bank word (72 of them: `ate` aside, the
fallback differs on exactly these) is among the differences, plus a named
sample. `test/bank.test.js` has one new test: 30 words (the ten from the plan
plus 20 mixed step 4/5, /s/ and /z/) checked for step, `g` = stem `g` + `s`,
stem in the bank at or before that step, and `s:z` presence/absence; and
`bigs reds nots ups muds mens mans puts comes gives paths` are in no bank.
Ran: `npm run check-bank` → `ok — 1180 entries (1:58 2:140 3:138 4:481 5:183
6:48 7:36 8:37 9:29 10:30), 37 heart words`; `npm test` → 118 tests, 118 pass,
0 fail; `npm run validate` → steps 1–5 each 100/100, `validate: ok`. No story
file touched.

## Found along the way

- The `sounds` of the existing step 1–5 magic-e words don't mark `u_e`'s two
  sounds (already noted in decodable-reader); the new `cubes mules tunes
  flutes` inherit that, unchanged.
- The -s rule leaves `-es` forms (`fishes dishes wishes boxes foxes kisses
  noses`) and past-tense/`-ing` forms out until step 10, by design; not a
  defect, just the next most-wanted class if the user asks.
