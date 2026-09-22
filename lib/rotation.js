// Story rotation (spec §4 "Story rotation"). Shared by the Node tests and the
// browser — no Node-only imports. Pure: reads its inputs, never changes them.
//
// pickStory(pool, progress, step, rand?) -> story | null
//   pool      array of stories for `step` that passed validation on load
//   progress  a normalized progress object (lib/progress.js)
//   step      the current step (keys progress.current_story / last_story)
//   rand      optional () => number in [0, 1); breaks ties inside a tier.
//             Omitted, ties go to the story earliest in `pool`.
//
// 1. Keep serving progress.current_story[step] while its reads < 3 and it is
//    still in the pool.
// 2. Otherwise, from the pool minus last_story[step] and minus the current
//    story (unless nothing else exists), pick in order:
//    a. unseen stories (not in progress.seen);
//    b. stories with reads < 3, fewest reads first;
//    c. everything has had 3 reads: oldest first by the last session that
//       read it (its latest index in progress.sessions; a story with no
//       retained session counts as oldest).
// Returns null on an empty pool. Never returns last_story[step] if any other
// story exists, so the same story is never served twice in a row.

export const MAX_READS = 3;

function readsOf(progress, id) {
  const n = progress && progress.reads ? progress.reads[id] : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Choose among the candidates that share the best key; ties by rand or order.
function pickBest(cands, key, rand) {
  let best = [];
  let bestKey = Infinity;
  for (const s of cands) {
    const k = key(s);
    if (k < bestKey) {
      bestKey = k;
      best = [s];
    } else if (k === bestKey) {
      best.push(s);
    }
  }
  if (best.length === 0) return null;
  if (typeof rand !== 'function' || best.length === 1) return best[0];
  const r = Number(rand());
  const i = Math.min(best.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * best.length)));
  return best[i];
}

export function pickStory(pool, progress, step, rand) {
  const stories = Array.isArray(pool) ? pool.filter((s) => s && typeof s.id === 'string') : [];
  if (stories.length === 0) return null;
  const p = progress || {};
  const cur = p.current_story ? p.current_story[step] : undefined;
  const last = p.last_story ? p.last_story[step] : undefined;

  const current = stories.find((s) => s.id === cur);
  if (current && readsOf(p, current.id) < MAX_READS) return current;

  let cands = stories.filter((s) => s.id !== last && s.id !== cur);
  if (cands.length === 0) cands = stories.filter((s) => s.id !== last);
  if (cands.length === 0) cands = stories;

  const seen = new Set(Array.isArray(p.seen) ? p.seen : []);
  const unseen = cands.filter((s) => !seen.has(s.id));
  if (unseen.length) return pickBest(unseen, () => 0, rand);

  const unfinished = cands.filter((s) => readsOf(p, s.id) < MAX_READS);
  if (unfinished.length) return pickBest(unfinished, (s) => readsOf(p, s.id), rand);

  const lastRead = new Map();
  const sessions = Array.isArray(p.sessions) ? p.sessions : [];
  sessions.forEach((sess, i) => {
    if (sess && typeof sess.story_id === 'string') lastRead.set(sess.story_id, i);
  });
  return pickBest(cands, (s) => (lastRead.has(s.id) ? lastRead.get(s.id) : -1), rand);
}
