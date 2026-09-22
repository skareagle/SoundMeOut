// Grapheme segmentation for the sound-out tray and the coloured story words.
// Shared by the Node tests and the browser — no Node-only imports.
//
// segment(word, index) -> [{ t, k, sound }]
//   word   a bare word: letters only, any casing ("Jack", "ship"). Use
//          splitToken() to get it from a story token like '"Stop!"'.
//   index  the Map from lib/bank.js buildIndex(banks)
//   t      the grapheme's text, in the ORIGINAL word's casing, so the texts
//          of the result join to `word` letter-for-letter ("Jack" -> J·a·ck)
//   k      kind: c consonant | v vowel | d digraph (incl. ll ss ff zz ck qu
//          ng nk, step-10 ed es le) | s silent | t vowel team
//   sound  the display sound for the tray, slashes included, lowercase:
//            default          "/" + grapheme text + "/"   ("/sh/", "/i/", "/ck/")
//            bank `sounds`    "text:tag" overrides it via SOUND_LABEL
//                             ("s:z" -> "/z/", "ea:short-e" -> "/e/",
//                             "oo:short-oo" -> "/ŏŏ/"); an unknown tag -> "/tag/"
//            magic-e vowel    the vowel before a silent e says its name:
//                             "/ā/ /ē/ /ī/ /ō/ /ū/" (vowel + U+0304 combining
//                             macron; check it renders in Andika)
//            silent e         null (the tray says nothing for it)
// The bank's pre-segmented `g` is used when the word is in the index (R7);
// otherwise the Appendix A splitter is the fallback (plus the step-3 doubles
// ll ss ff zz as kind d, the bank's convention). The fallback never throws; an
// empty word gives []. Non-letters are dropped by the fallback, and then the
// texts are lowercase and join to the word's letters only.
//
// Heart words are not in any bank, so segment() would run the fallback on
// them. The UI must check isHeartWord() first and not segment a heart word
// ("just tell him the word").

const DIGRAPHS = ['sh', 'ch', 'th', 'ck', 'wh', 'ph', 'ng', 'nk', 'qu', 'll', 'ss', 'ff', 'zz'];
const VOWELS = 'aeiou';
const MACRON = '\u0304'; // combining macron

// Sound tags used in word-banks.json `sounds` ("text:tag") -> what the tray
// shows between the slashes.
export const SOUND_LABEL = {
  z: 'z',
  'long-a': 'a' + MACRON,
  'long-e': 'e' + MACRON,
  'long-i': 'i' + MACRON,
  'long-o': 'o' + MACRON,
  'long-u': 'u' + MACRON,
  'short-e': 'e',
  'long-oo': 'oo',
  'short-oo': 'o\u0306o\u0306', // ŏŏ with combining breves, as in book
  ow: 'ow',
  ou: 'ow',
  d: 'd',
  t: 't',
  id: 'id',
  iz: 'iz',
  ul: 'ul',
};

const LONG_NAME = { a: 'long-a', e: 'long-e', i: 'long-i', o: 'long-o', u: 'long-u' };

function label(tag) {
  return '/' + (Object.hasOwn(SOUND_LABEL, tag) ? SOUND_LABEL[tag] : tag) + '/';
}

// Appendix A splitter (steps 1–5), lowercase in, lowercase [{t,k}] out.
export function fallbackGraphemes(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  let silentE = false;
  if (w.length >= 4 && w.endsWith('e')) {
    const c = w.charAt(w.length - 2);
    const v = w.charAt(w.length - 3);
    if (!VOWELS.includes(c) && VOWELS.includes(v)) silentE = true;
  }
  const body = silentE ? w.slice(0, -1) : w;
  const out = [];
  let i = 0;
  while (i < body.length) {
    const pair = body.substr(i, 2);
    if (pair.length === 2 && DIGRAPHS.includes(pair)) {
      out.push({ t: pair, k: 'd' });
      i += 2;
      continue;
    }
    const ch = body.charAt(i);
    out.push({ t: ch, k: VOWELS.includes(ch) ? 'v' : 'c' });
    i++;
  }
  if (silentE) out.push({ t: 'e', k: 's' });
  return out;
}

// Attach display sounds to lowercase graphemes, using the entry's `sounds`
// where present and the magic-e rule.
function withSounds(gs, sounds) {
  const out = gs.map((g, i) => {
    const s = Array.isArray(sounds) ? sounds[i] : undefined;
    let sound = '/' + g.t + '/';
    if (typeof s === 'string' && s.includes(':')) sound = label(s.slice(s.indexOf(':') + 1));
    return { t: g.t, k: g.k, sound, explicit: typeof s === 'string' && s.includes(':') };
  });
  for (let i = 0; i < out.length; i++) {
    if (out[i].k !== 's') continue;
    out[i].sound = null;
    // magic e: the nearest vowel grapheme before it says its name
    for (let j = i - 1; j >= 0; j--) {
      if (out[j].k === 'v') {
        if (!out[j].explicit && LONG_NAME[out[j].t]) out[j].sound = label(LONG_NAME[out[j].t]);
        break;
      }
      if (out[j].k !== 'c' && out[j].k !== 'd') break;
    }
  }
  return out.map(({ t, k, sound }) => ({ t, k, sound }));
}

// Re-apply the original word's casing to lowercase graphemes.
function recase(word, gs) {
  let used = 0;
  return gs.map((g) => {
    const t = word.substr(used, g.t.length);
    used += g.t.length;
    return { ...g, t };
  });
}

export function segment(word, index) {
  const w = typeof word === 'string' ? word : '';
  if (!w) return [];
  const entry = index && typeof index.get === 'function' ? index.get(w.toLowerCase()) : null;
  if (entry && Array.isArray(entry.g) && entry.g.map((p) => p[0]).join('') === w.toLowerCase()) {
    const gs = entry.g.map(([t, k]) => ({ t, k }));
    return recase(w, withSounds(gs, entry.sounds));
  }
  const gs = fallbackGraphemes(w);
  if (gs.map((g) => g.t).join('') !== w.toLowerCase()) {
    // non-letters in the input: return the cleaned graphemes as they are
    return withSounds(gs, null);
  }
  return recase(w, withSounds(gs, null));
}

// True if `word` (any casing) is in the set of heart words for this step,
// e.g. heartWords(step, scope) from lib/bank.js.
export function isHeartWord(word, hearts) {
  return typeof word === 'string' && !!hearts && hearts.has(word.toLowerCase());
}

// Split a whitespace token from a story line into the text before the word,
// the word itself (letters and internal apostrophes, original casing) and the
// text after it. A token with no letters gives word ''.
//   '"Stop!"' -> { pre: '"', word: 'Stop', post: '!"' }
export function splitToken(token) {
  const t = String(token);
  const m = /[A-Za-z](?:[A-Za-z'’]*[A-Za-z])?/.exec(t);
  if (!m) return { pre: t, word: '', post: '' };
  return { pre: t.slice(0, m.index), word: m[0], post: t.slice(m.index + m[0].length) };
}
