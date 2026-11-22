// Track AM-10155 (Task 3): the boundaries of a track's work, taken from the track files and git. Nothing here reads a transcript.
//   - the lane states over time (index.md in git, plus the working copy), cut into lane RUNS: a run starts at its claim
//     (`Lane Status: running`) and ends at the next state that is not running or waiting in the same lane (REQ-2);
//   - the plan's tasks and phases, and when each task was ticked (the commit that added its `[x]`);
//   - the human time: the span of a `(HUMAN)` task and every `waiting` status (decision D4).
// The functions that take parsed input are pure; the readers at the bottom run read-only git.
import { spawnSync } from 'node:child_process';
import { targetLaneOf } from '../../conductor/services/workflow-transitions.mjs';

const MARK_LANE = /^\+\*\*Lane\*\*:\s*(.+?)\s*$/;
const MARK_STATUS = /^\+\*\*Lane Status\*\*:\s*(.+?)\s*$/;
const WORKING = new Set(['running', 'waiting']);

const gitOut = (repo, args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return r.status === 0 ? r.stdout : '';
};

/** The `git log -p` output of one file as [{ t (ms), added: string[] }], oldest first. `--all` so work committed on a track branch counts. */
export function logAdded(repo, relPath) {
  const out = gitOut(repo, ['log', '--all', '--no-color', '--unified=0', '--format=%x01%H%x09%cI', '--', relPath]);
  const commits = [];
  for (const block of out.split('\x01').slice(1)) {
    const [head, ...rest] = block.split('\n');
    const t = Date.parse(head.split('\t')[1]);
    if (Number.isNaN(t)) continue;
    commits.push({ t, added: rest.filter((l) => l.startsWith('+') && !l.startsWith('+++')) });
  }
  return commits.sort((a, b) => a.t - b.t);
}

/** The lane state after each commit that changed it: [{ t, lane, status }]. A commit that touches only one marker keeps the other. */
export function statesFromCommits(commits, last = { lane: null, status: null }) {
  const states = [];
  let { lane, status } = last;
  for (const c of commits) {
    let l = lane;
    let s = status;
    for (const line of c.added) {
      const ml = MARK_LANE.exec(line);
      if (ml) l = ml[1].toLowerCase();
      const ms = MARK_STATUS.exec(line);
      if (ms) s = ms[1].toLowerCase();
    }
    if (l === lane && s === status) continue;
    lane = l; status = s;
    if (lane && status) states.push({ t: c.t, lane, status });
  }
  return states;
}

/** The lane and status of an index.md text as { lane, status } (lowercase), or nulls. */
export function markersOf(text) {
  const get = (name) => new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.+?)\\s*$`, 'm').exec(text ?? '')?.[1]?.toLowerCase() ?? null;
  return { lane: get('Lane'), status: get('Lane Status') };
}

const DEFAULT_ORDER = ['plan', 'implement', 'review', 'quality-gate', 'done'];

/**
 * The lanes in workflow order and the lane that follows each (the lane its `on_success` names when that is another lane, else the next
 * one in the order). Read from conductor/workflow.json text; falls back to the default five lanes.
 */
export function laneFlow(workflowText) {
  let lanes = null;
  try { lanes = JSON.parse(workflowText)?.lanes; } catch { /* default */ }
  const order = lanes && typeof lanes === 'object' && Object.keys(lanes).length ? Object.keys(lanes) : DEFAULT_ORDER;
  const next = (lane) => {
    const target = targetLaneOf(lanes?.[lane]?.on_success, lane, 'success');
    if (target && target !== lane && order.includes(target)) return target;
    const i = order.indexOf(lane);
    return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
  };
  return { order, next };
}

/**
 * Cuts the state timeline into lane runs.
 * A run is { lane, start, end, claimed, ran, open, endState, waiting: [[from, to]] }; `ran` is true when the lane status was `running` in it (a claimed running window, D26).
 * A claimed run starts at `Lane Status: running` and ends at the next state that is not running or waiting in the same lane.
 * Many tracks move on with no claim commit; then the lane whose turn it was (`queue` of a lane, or the lane after a `success`, the
 * "pending" lane) is taken to have run from the moment it became pending to the next state change: `claimed: false`, so the table says
 * so. The `done` lane never gets such a run (a merge is not agent work). A run that has not ended ends at `now` (`open: true`).
 */
export function lanesFromStates(states, now, flow = laneFlow(null)) {
  const runs = [];
  let cur = null;
  let wFrom = null;
  let pending = null; // { lane, t }
  const closeWaiting = (t) => { if (cur && wFrom !== null) { cur.waiting.push([wFrom, t]); wFrom = null; } };
  const finish = (t, endState) => { closeWaiting(t); cur.end = t; cur.endState = endState; runs.push(cur); cur = null; };
  const known = (lane) => flow.order.includes(lane) && lane !== 'done';
  for (const s of states) {
    if (cur && s.lane === cur.lane && WORKING.has(s.status)) {
      if (s.status === 'waiting' && wFrom === null) wFrom = s.t;
      if (s.status === 'running') { closeWaiting(s.t); cur.ran = true; }
      continue;
    }
    if (cur) finish(s.t, `${s.lane}:${s.status}`);
    else if (pending && !(WORKING.has(s.status) && s.lane === pending.lane) && !(s.status === 'queue' && s.lane === pending.lane)) {
      if (known(pending.lane) && s.t > pending.t) runs.push({ lane: pending.lane, start: pending.t, end: s.t, claimed: false, ran: false, open: false, endState: `${s.lane}:${s.status}`, waiting: [] });
    }
    pending = null;
    if (WORKING.has(s.status)) {
      cur = { lane: s.lane, start: s.t, end: null, claimed: true, ran: s.status === 'running', open: false, endState: null, waiting: [] };
      wFrom = s.status === 'waiting' ? s.t : null;
    } else if (s.status === 'queue') pending = { lane: s.lane, t: s.t };
    else if (s.status === 'success' || s.status === 'failure') { const nx = s.status === 'success' ? flow.next(s.lane) : s.lane; if (nx) pending = { lane: nx, t: s.t }; }
  }
  if (cur) { closeWaiting(now); cur.end = Math.max(now, cur.start); cur.open = true; cur.endState = 'still running'; runs.push(cur); }
  return runs;
}

/** The plan's tasks: [{ n, phase, phaseName, human }] from `## Phase N: name` headings and `- [ ] Task N ...` lines. */
export function parsePlan(text) {
  const tasks = [];
  let phase = null;
  let phaseName = '';
  for (const line of String(text ?? '').split('\n')) {
    const h = /^#{2,3}\s+Phase\s+(\d+)\b\s*:?\s*(.*)$/i.exec(line);
    if (h) { phase = Number(h[1]); phaseName = h[2].trim(); continue; }
    const t = /^\s*- \[[ xX]\].*?\bTask\s+(\d+)\b/.exec(line);
    if (t) tasks.push({ n: Number(t[1]), phase, phaseName, human: /\(HUMAN\)/i.test(line) });
  }
  return tasks;
}

/** The first time each task was ticked: [{ n, t }]. */
export function ticksFromCommits(commits) {
  const seen = new Map();
  for (const c of commits) {
    for (const line of c.added) {
      const m = /^\+\s*- \[[xX]\].*?\bTask\s+(\d+)\b/.exec(line);
      if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), c.t);
    }
  }
  return [...seen].map(([n, t]) => ({ n, t })).sort((a, b) => a.t - b.t || a.n - b.n);
}

const mergeSpans = (spans) => {
  const out = [];
  for (const [a, b] of [...spans].filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0])) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
};
export const overlap = (spans, from, to) => spans.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

/**
 * The time intervals of one run, chained from its start: one per task ticked inside the run (from the previous tick, or the claim, to
 * its own tick), then the rest up to the end. `human` is the milliseconds of each interval that is human time: the whole interval of a
 * `(HUMAN)` task, and any waiting status, each counted once.
 * @returns {{ intervals: { n: number|null, phase: number|null, phaseName: string, start: number, end: number, humanMs: number }[], humanSpans: number[][], humanMs: number }}
 */
export function intervalsOfRun(run, tasks, ticks, { withTasks = true } = {}) {
  const byN = new Map(tasks.map((t) => [t.n, t]));
  const mine = withTasks ? ticks.filter((k) => k.t >= run.start && k.t <= run.end) : [];
  const raw = [];
  let cursor = run.start;
  // Tasks ticked in ONE commit were finished somewhere inside the same stretch of time: it is shared equally between them, in task order
  // (the commit says nothing about who took longer). A `(HUMAN)` task among them therefore gets its share, no more.
  for (let i = 0; i < mine.length;) {
    let j = i;
    while (j < mine.length && mine[j].t === mine[i].t) j += 1;
    const group = mine.slice(i, j);
    const from = cursor;
    const to = Math.max(cursor, mine[i].t);
    group.forEach((k, g) => {
      const task = byN.get(k.n);
      raw.push({ n: k.n, phase: task?.phase ?? null, phaseName: task?.phaseName ?? '', start: Math.round(from + ((to - from) * g) / group.length), end: Math.round(from + ((to - from) * (g + 1)) / group.length), human: Boolean(task?.human) });
    });
    cursor = to;
    i = j;
  }
  raw.push({ n: null, phase: null, phaseName: '', start: cursor, end: run.end, human: false });
  const humanSpans = mergeSpans([...run.waiting, ...raw.filter((r) => r.human).map((r) => [r.start, r.end])]);
  const intervals = raw.map((r) => ({ n: r.n, phase: r.phase, phaseName: r.phaseName, start: r.start, end: r.end, humanMs: overlap(humanSpans, r.start, r.end) }));
  return { intervals, humanSpans, humanMs: overlap(humanSpans, run.start, run.end) };
}

// ---- Readers (read-only git and files). ----

/** The lane states of a track folder: git history of index.md, then the working copy when it differs. */
export function readRuns(repo, folder, indexText, now, workflowText = null) {
  const rel = `conductor/tracks/${folder}/index.md`;
  const states = statesFromCommits(logAdded(repo, rel));
  const cur = markersOf(indexText);
  const last = states[states.length - 1];
  if (cur.lane && cur.status && (!last || last.lane !== cur.lane || last.status !== cur.status)) states.push({ t: now, lane: cur.lane, status: cur.status });
  return lanesFromStates(states, now, laneFlow(workflowText));
}

/**
 * The lane runs of every track in `folders` in ONE git pass over the history of all index.md files (D26 needs every other track's windows, and one
 * `git log` per track would take half a minute). Same result as `readRuns` per folder. `indexOf(folder)` gives the working copy text.
 * @returns {{ folder: string, runs: object[] }[]}
 */
export function readAllRuns(repo, folders, indexOf, now, workflowText = null) {
  const out = gitOut(repo, ['log', '--all', '--no-color', '--unified=0', '--format=%x01%H%x09%cI', '--', 'conductor/tracks/*/index.md']);
  const byFolder = new Map(folders.map((f) => [f, []]));
  for (const block of out.split('\x01').slice(1)) {
    const lines = block.split('\n');
    const t = Date.parse(lines[0].split('\t')[1]);
    if (Number.isNaN(t)) continue;
    let target = null;
    for (const l of lines.slice(1)) {
      const d = /^diff --git a\/conductor\/tracks\/([^/]+)\/index\.md /.exec(l);
      if (d) { target = byFolder.has(d[1]) ? { t, added: [] } : null; if (target) byFolder.get(d[1]).push(target); continue; }
      if (target && l.startsWith('+') && !l.startsWith('+++')) target.added.push(l);
    }
  }
  const flow = laneFlow(workflowText);
  return folders.map((folder) => {
    const states = statesFromCommits(byFolder.get(folder).sort((a, b) => a.t - b.t));
    const cur = markersOf(indexOf(folder));
    const last = states[states.length - 1];
    if (cur.lane && cur.status && (!last || last.lane !== cur.lane || last.status !== cur.status)) states.push({ t: now, lane: cur.lane, status: cur.status });
    return { folder, runs: lanesFromStates(states, now, flow) };
  });
}

/** The plan's tasks (from the working copy) and when each was ticked (from git). */
export function readPlan(repo, folder, planText) {
  return { tasks: parsePlan(planText), ticks: ticksFromCommits(logAdded(repo, `conductor/tracks/${folder}/plan.md`)) };
}
