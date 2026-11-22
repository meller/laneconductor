// Track AM-10155 Phase 9 (D21, D22, D23): the recommendations across the last tracks, for the board's "Agent recommendations" drawer.
// Pure. The input is, per track, the facts block of its explain.md (rule ids and whole numbers, see recommendFacts in explain.mjs); the output is
// at most three ranked actions with one number each. Nothing here reads a transcript or any text of a track.
import { RULE_IDS, LONG_CONTEXT, SLOW_STEP_MS, fmtMs, parseRecommendFacts } from './explain.mjs';

/** How many of the newest tracks that have an explain.md the drawer looks at (D21). */
export const RECOMMEND_WINDOW = 10;
/** An action needs at least this many tracks, and so does the whole list (D22). */
export const MIN_TRACKS = 3;
/** The most actions shown (D21). */
export const MAX_ACTIONS = 3;

const num = (v) => Number(v).toLocaleString('en-US');

/** For each rule id: a title, the line that says how many tracks it applies to, and one plain sentence for the agent to apply (the Copy button). */
const ACTIONS = {
  where: {
    title: 'Run long lane work in a sub-agent or a fresh session',
    line: (c, m) => `${c} of ${m} tracks ran a lane with over ${num(LONG_CONTEXT)} tokens of history in the main session`,
    copy: `Run lane work in a sub-agent or a fresh session when the history of the main session is over ${num(LONG_CONTEXT)} tokens.`,
  },
  'lighter-model': {
    title: 'Use a lighter model for mechanical work',
    line: (c, m) => `${c} of ${m} tracks ran mechanical work with small replies on the largest model`,
    copy: 'Use a model one tier down (sonnet) for mechanical lane work, such as shell commands, reads and file edits with small replies, or for its sub-agent.',
  },
  'larger-model': {
    title: 'Keep a larger model for heavy work',
    line: (c, m) => `${c} of ${m} tracks ran work with big replies or much thinking on the smallest model`,
    copy: 'Keep a larger model (sonnet or above) for lane work with big replies or much thinking, and do not run it on the smallest model.',
  },
  'lower-effort': {
    title: 'Use a lower effort for mechanical work',
    line: (c, m) => `${c} of ${m} tracks ran mechanical work at a high effort or with much thinking`,
    copy: 'Use a lower effort for mechanical lane work, such as shell commands, reads and file edits.',
  },
  'allow-command': {
    title: 'Allow the slow commands in the permission settings',
    line: (c, m) => `${c} of ${m} tracks had a step that took ${fmtMs(SLOW_STEP_MS)} or more, a permission wait included`,
    copy: 'Allow the long-running commands in the permission settings so that a step does not wait for a click.',
  },
  claim: {
    title: 'Set the lane to running when starting it',
    line: (c, m) => `${c} of ${m} tracks have lane runs with no claim commit`,
    copy: 'Set the lane to running when starting it, so the lane run has a claim commit and its time is measured, not inferred.',
  },
};

/**
 * @param {{ number: number, facts: { v: 1, rules: { id: string, tokens: number }[] } | null }[]} tracks one entry per track that has an explain.md; `facts` is null when its explain.md has no facts block (not measured)
 * @returns {{ state: 'few' | 'quiet' | 'ok', message: string, measured: number, notMeasured: number, min: number, tracks: number[], actions: { id: string, title: string, count: number, tokens: number, text: string, copy: string }[] }}
 *   `tracks` are the numbers looked at, newest (highest number) first; `measured` is how many of them carry facts.
 */
export function rankRecommendations(tracks, { window = RECOMMEND_WINDOW, min = MIN_TRACKS, max = MAX_ACTIONS } = {}) {
  const looked = [...tracks].sort((a, b) => b.number - a.number).slice(0, window);
  const measured = looked.filter((t) => t.facts);
  const base = { measured: measured.length, notMeasured: looked.length - measured.length, min, tracks: looked.map((t) => t.number), actions: [] };
  if (measured.length < min) return { ...base, state: 'few', message: `Not enough tracks with statistics yet (${measured.length} of ${min})` };
  const actions = [];
  for (const id of RULE_IDS) {
    const hit = measured.filter((t) => t.facts.rules.some((x) => x.id === id));
    if (hit.length < min) continue;
    const tokens = hit.reduce((s, t) => s + t.facts.rules.filter((x) => x.id === id).reduce((a, x) => a + x.tokens, 0), 0);
    actions.push({ id, title: ACTIONS[id].title, count: hit.length, tokens, text: ACTIONS[id].line(hit.length, measured.length), copy: ACTIONS[id].copy });
  }
  // Most tracks first, then the most tokens; the order of RULE_IDS (a stable sort) settles the rest.
  actions.sort((a, b) => b.count - a.count || b.tokens - a.tokens);
  if (!actions.length) return { ...base, state: 'quiet', message: `No change suggested across the last ${looked.length} tracks.` };
  return { ...base, state: 'ok', message: '', actions: actions.slice(0, max) };
}

/** The same from explain.md texts: `items` is [{ number, text }]; a text with no facts block is not measured. */
export function rankFromExplains(items, opts) {
  return rankRecommendations(items.map((it) => ({ number: it.number, facts: parseRecommendFacts(it.text) })), opts);
}
