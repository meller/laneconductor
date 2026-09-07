// conductor/services/fuzzy-match.mjs
// Track 10080 (REQ-12): shared subsequence fuzzy matcher, imported by both
// the API server (files endpoint) and the browser (composer autocomplete
// menus) — same reasoning as conductor/services/merge-mode.mjs: pure logic
// with no side-effecting imports so it can be shared without pulling in
// either host's runtime.
//
// Scoring is a dynamic-programming subsequence match, not a greedy
// leftmost one: a greedy scan would happily match the "c" in "src" before
// ever reaching "chat" later in the same path, producing a scattered,
// low-quality alignment when a much better one exists further along the
// string. The DP considers every valid alignment and keeps the
// highest-scoring one.
//
// Per-character bonuses (added only for characters that end up matched):
//   - starts right after '/' or is the very first character (a path
//     segment boundary)
//   - falls inside the basename (after the last '/') rather than a
//     directory component
//   - continues a run of consecutive matched characters
//   - occurs earlier in the candidate (tiny weight — a tiebreaker, not a
//     driver)
// A tiny shorter-candidate bonus is added at the end as a last-resort
// tiebreak; `fuzzyRank` breaks any remaining exact ties by candidate
// string so ordering is always total and stable.

const SEGMENT_BONUS = 10;
const BASENAME_BONUS = 4;
const CONSECUTIVE_BONUS = 8;
const CHAR_MATCH_SCORE = 1;

function computePositionBonuses(candidate) {
  const n = candidate.length;
  const basenameStart = candidate.lastIndexOf('/') + 1;
  const bonuses = new Array(n);
  for (let j = 0; j < n; j++) {
    let bonus = 0;
    if (j === 0 || candidate[j - 1] === '/') bonus += SEGMENT_BONUS;
    if (j >= basenameStart) bonus += BASENAME_BONUS;
    // Earlier-position tiebreak: a small, monotonically decreasing weight
    // so matching sooner in the string is preferred, all else equal.
    bonus += (n - j) * 0.001;
    bonuses[j] = bonus;
  }
  return bonuses;
}

/**
 * Case-insensitive subsequence match. Returns a numeric score, or `null`
 * when `query` is not a subsequence of `candidate` at all — callers filter
 * on the `null` to drop non-matches.
 */
export function fuzzyScore(candidate, query) {
  if (!query) return 0;
  if (!candidate) return null;

  const n = candidate.length;
  const m = query.length;
  const candLower = candidate.toLowerCase();
  const q = query.toLowerCase();
  const bonuses = computePositionBonuses(candidate);

  const NEG_INF = -Infinity;
  // best[j]: highest score aligning the first i query chars within the
  // first j candidate chars (not necessarily ending in a match at j).
  // matched[j]: same, but requiring q[i-1] to be matched exactly at
  // candidate index j-1 (needed to detect/reward consecutive runs).
  let best = new Array(n + 1).fill(0);
  let matched = new Array(n + 1).fill(NEG_INF);

  for (let i = 1; i <= m; i++) {
    const qch = q[i - 1];
    const newMatched = new Array(n + 1).fill(NEG_INF);
    const newBest = new Array(n + 1).fill(NEG_INF);
    for (let j = 1; j <= n; j++) {
      if (candLower[j - 1] === qch) {
        const viaConsecutive = matched[j - 1] !== NEG_INF
          ? matched[j - 1] + CONSECUTIVE_BONUS + bonuses[j - 1] + CHAR_MATCH_SCORE
          : NEG_INF;
        const viaFresh = best[j - 1] !== NEG_INF
          ? best[j - 1] + bonuses[j - 1] + CHAR_MATCH_SCORE
          : NEG_INF;
        newMatched[j] = Math.max(viaConsecutive, viaFresh);
      }
      newBest[j] = Math.max(newBest[j - 1], newMatched[j]);
    }
    matched = newMatched;
    best = newBest;
  }

  const finalScore = best[n];
  if (finalScore === NEG_INF) return null;

  // Final tiebreak: a shorter candidate wins between otherwise-equal
  // matches, weighted small enough to never outrank a real bonus above.
  return finalScore + Math.max(0, 40 - candidate.length) * 0.01;
}

/**
 * Ranks `candidates` (an array of strings, or objects when `key` is given)
 * against `query`, best match first. Non-matches are dropped. Ties are
 * broken by the candidate string ascending, so ordering is total and
 * stable across runs. An empty/absent query returns the first `limit`
 * candidates in input order, unscored.
 */
export function fuzzyRank(candidates, query, { limit = Infinity, key } = {}) {
  const getStr = key ? (c => key(c)) : (c => c);

  if (!query) {
    return candidates.slice(0, limit);
  }

  const scored = [];
  for (const candidate of candidates) {
    const str = getStr(candidate);
    const score = fuzzyScore(str, query);
    if (score !== null) scored.push({ candidate, str, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.str < b.str ? -1 : a.str > b.str ? 1 : 0;
  });

  return scored.slice(0, limit).map(s => s.candidate);
}
