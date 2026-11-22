// Track AM-10155: the EXPLAIN for agent work. Joins the track files and git (the boundaries) with the session transcripts (the numbers)
// and renders `explain.md`. Read only toward the repository and the transcripts; the caller writes the file.
// Numbers only: see explain-transcripts.mjs for what is kept from a transcript (never text).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTrack } from './tracks.mjs';
import { readRuns, readPlan, intervalsOfRun } from './explain-boundaries.mjs';
import { collectMessages } from './explain-transcripts.mjs';

/** Printed next to every table (decision D3). Tests look for the words overlap, other activity and machines. */
export const APPROX_NOTE = 'Approximate: a message is attributed to a track by its time window and working directory or branch, so several tracks that overlap in time can share messages, the computer may have been doing other activity at the same time, and different execution machines run at different speeds. Read these as relative numbers, not exact ones. Human time counts only tasks marked (HUMAN) and the waiting status; a person who chats in the same session without either is counted as agent time, and the gaps of more than 30 minutes are shown as a note only.';

const ZERO = () => ({ output: 0, fresh: 0, cacheCreated: 0, cacheRead: 0 });
const NOT_SLOW = new Set(['Agent', 'Task', 'AskUserQuestion', 'SendMessage', 'ScheduleWakeup', 'TaskOutput']);
const SLOW_N = 5;
const GAP_MS = 30 * 60000;

const iso = (ms) => new Date(ms).toISOString();

const gitRoot = (repo) => {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const common = r.status === 0 ? r.stdout.trim() : '';
  return common && path.basename(common) === '.git' ? path.dirname(common) : repo;
};

function emptyBucket() {
  return { responses: 0, tokens: ZERO(), tools: {}, sub: { responses: 0, output: 0 }, times: [], reads: new Map(), toolRuns: [], asks: [], firstMsg: null, firstSub: null, subFirst: new Map() };
}

function addMessage(b, m, results) {
  b.responses += 1;
  b.tokens.output += m.usage.output; b.tokens.fresh += m.usage.fresh; b.tokens.cacheCreated += m.usage.cacheCreated; b.tokens.cacheRead += m.usage.cacheRead;
  if (m.sub) { b.sub.responses += 1; b.sub.output += m.usage.output; }
  b.times.push(m.ts);
  // D10: the first response of the run is the first message of the main session; a sub-agent still replying from the previous lane must not count. The earliest sub-agent message is only the fallback.
  if (m.sub) { if (!b.firstSub || m.ts < b.firstSub.ts) b.firstSub = m; } else if (!b.firstMsg || m.ts < b.firstMsg.ts) b.firstMsg = m;
  if (m.sub) { const k = m.agent ?? m.id; const cur = b.subFirst.get(k); if (!cur || m.ts < cur.ts) b.subFirst.set(k, m); }
  for (const t of m.tools) {
    b.tools[t.name] = (b.tools[t.name] ?? 0) + 1;
    if (t.fileKey) b.reads.set(t.fileKey, (b.reads.get(t.fileKey) ?? 0) + 1);
    const done = results.get(t.id);
    if (t.name === 'AskUserQuestion') b.asks.push(done !== undefined && done >= t.ts ? done - t.ts : 0);
    if (done !== undefined && done >= t.ts && !NOT_SLOW.has(t.name)) b.toolRuns.push({ tool: t.name, ms: done - t.ts, at: iso(t.ts) });
  }
}

const sortedTools = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const contextOf = (m) => m.usage.fresh + m.usage.cacheCreated + m.usage.cacheRead;
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };

function finish(b) {
  const times = [...b.times].sort((a, c) => a - c);
  let gaps = 0;
  for (let i = 1; i < times.length; i += 1) if (times[i] - times[i - 1] > GAP_MS) gaps += 1;
  let repeated = 0;
  for (const n of b.reads.values()) repeated += n - 1;
  return {
    responses: b.responses,
    tokens: b.tokens,
    tools: sortedTools(b.tools),
    sub: b.sub,
    firstContext: (b.firstMsg ?? b.firstSub) ? contextOf(b.firstMsg ?? b.firstSub) : 0,
    subStarts: [...b.subFirst.values()].map(contextOf),
    repeatedReads: repeated,
    slowest: b.toolRuns.sort((a, c) => c.ms - a.ms).slice(0, SLOW_N),
    gapsOver30: gaps,
    asks: { count: b.asks.length, ms: b.asks.reduce((a, c) => a + c, 0) },
  };
}

/**
 * Everything the explain reports for one track.
 * @param {{ repo: string, track: number|string, projectsDir: string, now?: string }} a
 */
export async function analyzeTrack({ repo, track, projectsDir, now = new Date().toISOString() }) {
  const number = Number(String(track).replace(/^[A-Za-z]+-/, ''));
  const nowMs = Date.parse(now);
  const tracksDir = path.join(repo, 'conductor/tracks');
  const folder = resolveTrack(fs.readdirSync(tracksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name), String(number));
  const read = (f) => { try { return fs.readFileSync(path.join(tracksDir, folder, f), 'utf8'); } catch { return ''; } };
  let workflow = null;
  try { workflow = fs.readFileSync(path.join(repo, 'conductor/workflow.json'), 'utf8'); } catch { /* default lanes */ }
  const runs = readRuns(repo, folder, read('index.md'), nowMs, workflow);
  const { tasks, ticks } = readPlan(repo, folder, read('plan.md'));
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const rootReal = real(gitRoot(repo));
  const roots = [...new Set([rootReal, real(repo), gitRoot(repo), repo])];
  const sinceMs = runs.length ? Math.min(...runs.map((r) => r.start)) : nowMs;
  const found = runs.length ? await collectMessages({ projectsDir, roots, root: rootReal, track: number, sinceMs }) : { messages: [], results: new Map(), skipped: { otherTrack: 0, outsideRepo: 0 }, sessions: [], mainFiles: 0, subFiles: 0 };

  const perRun = runs.map((run) => {
    const ivs = intervalsOfRun(run, tasks, ticks, { withTasks: run.lane === 'implement' });
    return { run, ...ivs, bucket: emptyBucket(), ivBuckets: ivs.intervals.map(() => emptyBucket()) };
  });
  const none = { responses: 0, output: 0 };
  for (const m of found.messages) {
    const idx = perRun.findIndex((p) => m.ts >= p.run.start && m.ts < p.run.end);
    if (idx < 0) { none.responses += 1; none.output += m.usage.output; continue; }
    const p = perRun[idx];
    addMessage(p.bucket, m, found.results);
    const j = p.intervals.findIndex((iv) => m.ts >= iv.start && m.ts < iv.end);
    addMessage(p.ivBuckets[j < 0 ? p.intervals.length - 1 : j], m, found.results);
  }

  const outRuns = perRun.map((p) => {
    const f = finish(p.bucket);
    const wallMs = p.run.end - p.run.start;
    return { lane: p.run.lane, start: iso(p.run.start), end: iso(p.run.end), claimed: p.run.claimed, open: p.run.open, endState: p.run.endState, wallMs, humanMs: p.humanMs, agentMs: wallMs - p.humanMs, ...f };
  });

  // Phases: the implement runs' intervals, summed by the phase of the task that ended each one.
  const phaseMap = new Map();
  perRun.forEach((p, i) => {
    if (p.run.lane !== 'implement') return;
    p.intervals.forEach((iv, j) => {
      const key = iv.n === null ? 'after' : iv.phase === null ? 'other' : `Phase ${iv.phase}`;
      const label = iv.n === null ? 'After the last tick (wrap-up)' : iv.phase === null ? 'Ticked tasks not in the plan' : `Phase ${iv.phase}${iv.phaseName ? `: ${iv.phaseName}` : ''}`;
      let e = phaseMap.get(key);
      if (!e) { e = { key, label, order: iv.n === null ? 1e6 : iv.phase === null ? 5e5 : iv.phase, wallMs: 0, humanMs: 0, bucket: emptyBucket(), tasks: 0 }; phaseMap.set(key, e); }
      e.wallMs += iv.end - iv.start; e.humanMs += iv.humanMs; if (iv.n !== null) e.tasks += 1;
      const src = p.ivBuckets[j];
      const dst = e.bucket;
      dst.responses += src.responses; dst.tokens.output += src.tokens.output; dst.tokens.fresh += src.tokens.fresh; dst.tokens.cacheCreated += src.tokens.cacheCreated; dst.tokens.cacheRead += src.tokens.cacheRead;
      dst.sub.responses += src.sub.responses; dst.sub.output += src.sub.output;
      for (const [k, v] of Object.entries(src.tools)) dst.tools[k] = (dst.tools[k] ?? 0) + v;
    });
  });
  const phases = [...phaseMap.values()].sort((a, b) => a.order - b.order).map((e) => ({ key: e.key, label: e.label, tasks: e.tasks, wallMs: e.wallMs, humanMs: e.humanMs, agentMs: e.wallMs - e.humanMs, responses: e.bucket.responses, tokens: e.bucket.tokens, tools: sortedTools(e.bucket.tools), sub: e.bucket.sub }));
  // The "after" row is only worth a row when something happened in it.
  const shown = phases.filter((p) => p.key !== 'after' || p.wallMs > 0 || p.responses > 0);

  return {
    track: { number, folder },
    generatedAt: iso(nowMs),
    runs: outRuns,
    phases: shown,
    none,
    skipped: found.skipped,
    sources: { mainFiles: found.mainFiles, subFiles: found.subFiles, sessions: found.sessions.map((s) => s.slice(0, 8)) },
  };
}

// ---- Rendering. The tables are the stored record AND the input of the project statistics, so their columns are fixed. ----

export const fmtMs = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
export const parseMs = (text) => {
  const t = String(text).trim();
  let m = /^(\d+)h (\d+)m$/.exec(t); if (m) return (Number(m[1]) * 60 + Number(m[2])) * 60000;
  m = /^(\d+)m$/.exec(t); if (m) return Number(m[1]) * 60000;
  m = /^(\d+)s$/.exec(t); if (m) return Number(m[1]) * 1000;
  return 0;
};
const n = (x) => Number(x).toLocaleString('en-US');
const parseN = (text) => Number(String(text).replace(/[^0-9]/g, '')) || 0;
const stamp = (isoText) => isoText.slice(0, 16).replace('T', ' ');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '0%');
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
const toolCount = (tools) => Object.values(tools).reduce((s, v) => s + v, 0);

export const RUN_HEAD = '| Lane | Start (UTC) | End (UTC) | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |';
export const PHASE_HEAD = '| Phase | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |';
const sep = (head) => `|${head.split('|').slice(1, -1).map(() => ' --- |').join('')}`;

// ---- The insight (decisions D13, D14): rule-based observations worked out from the numbers only. No model, no content: every sentence is
// built from times, counts, token numbers, lane and phase names and tool names that the tables below it already show.

const LONG_CONTEXT = 400000;
const LOW_SUB_SHARE = 30;
const MOSTLY_HUMAN = 80;
const SLOW_STEP_MS = 5 * 60000;
const INSIGHT_LABEL = 'These are rule-based observations worked out by the script from the numbers below, not an opinion of a model. No prompt, message or file content is used.';
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
const ratioText = (read, written) => `${n(Math.round(read / written))} times the tokens written`;
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const biggest = (rows, key) => rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]);

/** The `## Insight` section of one track (lines, no trailing blank). */
export function renderInsight(r) {
  const L = ['## Insight', '', INSIGHT_LABEL, ''];
  if (!r.runs.length) { L.push('- No lane run found in the history of this track, so there is nothing to observe yet.', ''); return L; }
  const runs = r.runs;
  const wall = sum(runs, 'wallMs'); const human = sum(runs, 'humanMs'); const agent = sum(runs, 'agentMs');
  L.push(`- Time: ${fmtMs(wall)} wall, ${fmtMs(agent)} agent, ${fmtMs(human)} human, over ${plural(runs.length, 'lane run', 'lane runs')}.`);
  if (wall > 0 && pctOf(human, wall) >= MOSTLY_HUMAN) L.push(`- Most of the wall time (${pctOf(human, wall)}%) was waiting for a person, not agent work.`);
  const replies = sum(runs, 'responses');
  const out = runs.reduce((s, x) => s + x.tokens.output, 0);
  const read = runs.reduce((s, x) => s + x.tokens.cacheRead, 0);
  if (!replies) L.push('- Work: no replies were found in the lane windows (no session transcript matched, or the lanes ran on another machine).');
  else L.push(`- Work: ${plural(replies, 'reply', 'replies')}, ${n(out)} tokens written, ${n(read)} tokens read from cache${out ? ` (${ratioText(read, out)})` : ''}, ${n(Math.round(read / replies))} per reply on average.`);
  const mains = runs.filter((x) => x.responses && x.firstContext > 0);
  const subStarts = runs.flatMap((x) => x.subStarts);
  if (mains.length || subStarts.length) {
    const parts = [];
    if (mains.length) parts.push(`the first reply of the lane runs in the main session started with ${n(median(mains.map((x) => x.firstContext)))} tokens of context${mains.length > 1 ? ` (median of ${mains.length} runs, highest ${n(Math.max(...mains.map((x) => x.firstContext)))})` : ''}`);
    if (subStarts.length) parts.push(`sub-agents started with a median of ${n(median(subStarts))} tokens`);
    L.push(`- Context: ${parts.join('; ')}.`);
  }
  const subReplies = runs.reduce((s, x) => s + x.sub.responses, 0);
  const subOut = runs.reduce((s, x) => s + x.sub.output, 0);
  const subRuns = runs.reduce((s, x) => s + x.subStarts.length, 0);
  if (replies && subReplies) L.push(`- Sub-agents: ${pctOf(subReplies, replies)}% of replies and ${pctOf(subOut, out)}% of output, ${plural(subRuns, 'run', 'runs')}.`);
  else if (replies) L.push('- Sub-agents: none were used.');
  const laneMap = new Map();
  for (const x of runs) { const e = laneMap.get(x.lane) ?? { name: x.lane, wallMs: 0, output: 0 }; e.wallMs += x.wallMs; e.output += x.tokens.output; laneMap.set(x.lane, e); }
  if (laneMap.size > 1) {
    const lanes = [...laneMap.values()];
    L.push(`- Biggest lane by time: ${biggest(lanes, 'wallMs').name} (${fmtMs(biggest(lanes, 'wallMs').wallMs)}). ${out ? `Biggest lane by tokens written: ${biggest(lanes, 'output').name} (${n(biggest(lanes, 'output').output)}).` : ''}`.trim());
  }
  const phases = r.phases.map((p) => ({ name: p.label, wallMs: p.wallMs, output: p.tokens.output }));
  if (phases.length > 1) {
    const pt = biggest(phases, 'wallMs'); const pk = biggest(phases, 'output');
    L.push(`- Biggest phase by time: ${pt.name} (${fmtMs(pt.wallMs)}). ${pk.output ? `Biggest phase by tokens written: ${pk.name} (${n(pk.output)}).` : ''}`.trim());
  }
  L.push('', '**What to look at**', '');
  const look = [];
  for (const x of runs) {
    const share = pctOf(x.sub.responses, x.responses);
    if (x.responses && x.firstContext >= LONG_CONTEXT && share < LOW_SUB_SHARE) look.push(`- The ${x.lane} run starting ${stamp(x.start)} began with ${n(x.firstContext)} tokens of context in the main session and only ${share}% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.`);
  }
  const bounds = runs.filter((x) => !x.claimed || x.open);
  if (bounds.length) look.push(`- ${plural(bounds.length, 'lane run has', 'lane runs have')} no claim commit or ${bounds.length === 1 ? 'was' : 'were'} never closed (${bounds.map((x) => x.lane).join(', ')}): their times are upper bounds; claim the lane when starting it (set it to running).`);
  const repeated = sum(runs, 'repeatedReads');
  if (repeated) look.push(`- ${plural(repeated, 'repeated read', 'repeated reads')}: files read more than once in the same run.`);
  const gaps = sum(runs, 'gapsOver30');
  if (gaps) look.push(`- ${plural(gaps, 'gap', 'gaps')} of more than 30 minutes between messages.`);
  const slow = runs.flatMap((x) => x.slowest).sort((a, c) => c.ms - a.ms)[0];
  if (slow && slow.ms >= SLOW_STEP_MS) look.push(`- The slowest step was ${slow.tool} ${fmtMs(slow.ms)} at ${stamp(slow.at)} (a permission wait is included).`);
  L.push(...(look.length ? look : ['- Nothing unusual: none of the rules above fired.']), '');
  return L;
}

/** The markdown of explain.md (the same text is printed). `now` is the generated time; it is the only line that differs between two runs on the same data. */
export function renderExplain(r, { now = r.generatedAt } = {}) {
  const L = [];
  L.push(`# Agent run: ${r.track.folder}`, '', ...renderInsight(r), '> Generated by lc-explain.mjs from session transcripts and git; do not edit by hand (it is overwritten on each run). Numbers only: no prompt, message or file content is read into it.', '');
  L.push(`Generated: ${now}`);
  const s = r.sources;
  const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  L.push(`Sources: ${pl(s.mainFiles, 'session file', 'session files')}, ${pl(s.subFiles, 'sub-agent file', 'sub-agent files')}${s.sessions.length ? ` (sessions ${s.sessions.join(', ')})` : ''}; the lane and plan boundaries come from git history of this track's index.md and plan.md.`, '');
  L.push(`> ${APPROX_NOTE}`, '');
  L.push('## Lane runs', '');
  if (!r.runs.length) L.push('No lane run found in the history of this track.', '');
  else {
    L.push(RUN_HEAD, sep(RUN_HEAD));
    for (const x of r.runs) {
      const share = x.responses ? `${pct(x.sub.responses, x.responses)} of responses, ${pct(x.sub.output, x.tokens.output)} of output` : '0%';
      const lane = `${x.lane}${x.claimed ? '' : ' (no claim commit)'}${x.open ? ' (still running)' : ''}`;
      L.push(`| ${lane} | ${stamp(x.start)} | ${stamp(x.end)} | ${fmtMs(x.wallMs)} | ${fmtMs(x.agentMs)} | ${fmtMs(x.humanMs)} | ${n(x.responses)} | ${n(x.tokens.output)} | ${n(x.tokens.fresh)} | ${n(x.tokens.cacheCreated)} | ${n(x.tokens.cacheRead)} | ${n(toolCount(x.tools))} | ${share} |`);
    }
    if (r.runs.some((x) => !x.claimed || x.open)) L.push('', '"no claim commit" marks a lane that moved on without ever being set to running: its window runs from the moment the lane was next in line (queue, or the previous lane done) to the next state change, so it includes any wait in the queue and, in a session shared with other tracks, other tracks\' messages. "still running" marks a lane whose status was never closed. Treat both as upper bounds; the Statistics tab keeps them in separate rows from claimed runs.');
    L.push('', 'Tokens are shown apart: output is what the model wrote, fresh input is what it read without the cache, cache created is context stored for reuse, cache read is stored context read again (large and cheap). A response is one model reply; its tokens are counted once even though the transcript writes one line per content block.', '');
  }
  if (r.phases.length) {
    L.push('## Phases of the implement lane', '', PHASE_HEAD, sep(PHASE_HEAD));
    for (const p of r.phases) {
      const share = p.responses ? `${pct(p.sub.responses, p.responses)} of responses` : '0%';
      L.push(`| ${p.label} | ${fmtMs(p.wallMs)} | ${fmtMs(p.agentMs)} | ${fmtMs(p.humanMs)} | ${n(p.responses)} | ${n(p.tokens.output)} | ${n(p.tokens.fresh)} | ${n(p.tokens.cacheCreated)} | ${n(p.tokens.cacheRead)} | ${n(toolCount(p.tools))} | ${share} |`);
    }
    L.push('', 'A phase runs from the previous plan tick (or the claim) to the tick of its last task; a `(HUMAN)` task is human time. Tasks ticked in the same commit share their stretch of time equally, because the commit does not say which took longer.', '');
  }
  for (const x of r.runs) {
    const tools = Object.entries(x.tools);
    if (!tools.length && !x.slowest.length) continue;
    L.push(`## Detail: ${x.lane} run starting ${stamp(x.start)}`, '');
    L.push(`- Tool calls by kind: ${tools.length ? tools.slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ') + (tools.length > 12 ? `, and ${tools.length - 12} more kinds` : '') : 'none'}`);
    L.push(`- Files read more than once: ${x.repeatedReads} repeated read${x.repeatedReads === 1 ? '' : 's'}`);
    L.push(`- Context of the first response of the run: ${n(x.firstContext)} tokens${x.subStarts.length ? `; ${x.subStarts.length} sub-agent run${x.subStarts.length === 1 ? '' : 's'} started with a median of ${n(median(x.subStarts))} tokens of context` : ''}`);
    if (x.asks.count) L.push(`- Questions put to the human (the AskUserQuestion tool): ${x.asks.count}, waited ${fmtMs(x.asks.ms)} in total (a note only; the Human column counts only the (HUMAN) tasks and the waiting status)`);
    L.push(`- Gaps of more than 30 minutes between messages: ${x.gapsOver30} (a note only)`);
    if (x.slowest.length) L.push(`- Slowest tool steps (call to result, so a permission wait is included): ${x.slowest.map((t) => `${t.tool} ${fmtMs(t.ms)} at ${stamp(t.at)}`).join('; ')}`);
    L.push('');
  }
  L.push('## Outside every lane run', '', `Responses in the scanned sessions of this repository that fall outside every lane window of this track: ${n(r.none.responses)} (${n(r.none.output)} output tokens). Left out as not this track: ${n(r.skipped.otherTrack)} on another track's branch or sub-agent, ${n(r.skipped.outsideRepo)} in another folder.`, '');
  return `${L.join('\n')}`;
}

// ---- The project statistics: one row per track, built from every track's explain.md (decision D1). ----

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
/** Reads the tables of one explain.md back into numbers. */
export function parseExplain(text) {
  const out = { runs: [], phases: [] };
  const lines = String(text).split('\n');
  const tableAfter = (heading) => {
    const i = lines.findIndex((l) => l.startsWith(heading));
    if (i < 0) return [];
    const rows = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('## ')) break;
      if (lines[j].startsWith('|') && !/^\|[\s|-]+$/.test(lines[j]) && lines[j] !== RUN_HEAD && lines[j] !== PHASE_HEAD) rows.push(cells(lines[j]));
    }
    return rows;
  };
  for (const c of tableAfter('## Lane runs')) out.runs.push({ lane: c[0], wallMs: parseMs(c[3]), agentMs: parseMs(c[4]), humanMs: parseMs(c[5]), responses: parseN(c[6]), output: parseN(c[7]), fresh: parseN(c[8]), cacheCreated: parseN(c[9]), cacheRead: parseN(c[10]), tools: parseN(c[11]) });
  for (const c of tableAfter('## Phases of the implement lane')) out.phases.push({ label: c[0], key: /^Phase (\d+)/.exec(c[0])?.[0] ?? c[0], wallMs: parseMs(c[1]), agentMs: parseMs(c[2]), humanMs: parseMs(c[3]), responses: parseN(c[4]), output: parseN(c[5]), fresh: parseN(c[6]), cacheCreated: parseN(c[7]), cacheRead: parseN(c[8]), tools: parseN(c[9]) });
  return out;
}

const STAT_HEAD = '| Track | Lane runs | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls |';
const LANE_HEAD = '| Lane | Runs | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls |';
const PH_HEAD = '| Phase | Tracks | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls |';
const rowOf = (label, count, rows) => `| ${label} | ${count} | ${fmtMs(sum(rows, 'wallMs'))} | ${fmtMs(sum(rows, 'agentMs'))} | ${fmtMs(sum(rows, 'humanMs'))} | ${n(sum(rows, 'responses'))} | ${n(sum(rows, 'output'))} | ${n(sum(rows, 'fresh'))} | ${n(sum(rows, 'cacheCreated'))} | ${n(sum(rows, 'cacheRead'))} | ${n(sum(rows, 'tools'))} |`;

const trackLabel = (folder) => folder.replace(/^([A-Za-z]+-)?(\d+)-.*$/, (m, pre, num) => `${pre ?? ''}${num}`);

/** The `## Insight` of statistics.md across tracks (D14). The finished tracks with no statistics yet are added by the board when it is built (markUnrecordedStatistics in board-docs.mjs). */
function renderStatisticsInsight(parsed) {
  const L = ['## Insight', '', INSIGHT_LABEL, ''];
  if (!parsed.length) { L.push('- No track has statistics yet.', ''); return L; }
  const rows = parsed.map((p) => ({ label: trackLabel(p.folder), wall: sum(p.runs, 'wallMs'), human: sum(p.runs, 'humanMs'), out: sum(p.runs, 'output'), read: sum(p.runs, 'cacheRead') }));
  L.push(`- ${parsed.length === 1 ? '1 track has' : `${parsed.length} tracks have`} statistics.`);
  const withOut = rows.filter((x) => x.out > 0);
  if (withOut.length) { const top = withOut.reduce((b, x) => (x.read / x.out > b.read / b.out ? x : b), withOut[0]); L.push(`- Highest cache-read ratio: ${top.label} (${ratioText(top.read, top.out)}).`); }
  const waited = rows.filter((x) => x.human > 0);
  if (waited.length) { const top = biggest(waited, 'human'); L.push(`- Most human waiting: ${top.label} (${fmtMs(top.human)}, ${pctOf(top.human, top.wall)}% of its wall time).`); }
  L.push(`- Total across tracks: ${n(sum(rows, 'out'))} tokens written and ${n(sum(rows, 'read'))} tokens read from cache.`);
  L.push('- The board lists the finished tracks that have no statistics yet at the end of this page.', '');
  return L;
}

/**
 * The text of conductor/statistics.md from every track's explain.md: `items` is [{ folder, text }]. Finished tracks are included.
 */
export function renderStatistics(items, { now }) {
  const parsed = items.map((it) => ({ folder: it.folder, ...parseExplain(it.text) })).sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
  const L = ['# Agent run statistics', '', ...renderStatisticsInsight(parsed), '> Generated by lc-explain.mjs from every track\'s explain.md; do not edit by hand. Numbers only.', '', `Generated: ${now}`, `Tracks with an explain.md: ${parsed.length}`, '', `> ${APPROX_NOTE}`, ''];
  L.push('## Tracks', '');
  if (!parsed.length) L.push('No track has an explain.md yet. Run `node lc-explain.mjs --repo . --track <number>`.', '');
  else {
    L.push(STAT_HEAD, sep(STAT_HEAD));
    for (const p of parsed) L.push(rowOf(trackLabel(p.folder), p.runs.length, p.runs));
    L.push('');
    L.push('## Lane totals', '', LANE_HEAD, sep(LANE_HEAD));
    const lanes = [...new Set(parsed.flatMap((p) => p.runs.map((r) => r.lane)))];
    for (const lane of lanes) { const rows = parsed.flatMap((p) => p.runs.filter((r) => r.lane === lane)); L.push(rowOf(lane, rows.length, rows)); }
    L.push('');
    const keys = [...new Set(parsed.flatMap((p) => p.phases.map((r) => r.key)))].sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 1e9) - (parseInt(b.replace(/\D/g, ''), 10) || 1e9));
    if (keys.length) {
      L.push('## Phase totals (implement lane, by phase number)', '', PH_HEAD, sep(PH_HEAD));
      for (const k of keys) { const rows = parsed.flatMap((p) => p.phases.filter((r) => r.key === k)); L.push(rowOf(k, parsed.filter((p) => p.phases.some((r) => r.key === k)).length, rows)); }
      L.push('');
    }
  }
  return L.join('\n');
}

/** Reads every `conductor/tracks/<folder>/explain.md` (live tracks only) as [{ folder, text }]. */
export function readExplains(repo) {
  const dir = path.join(repo, 'conductor/tracks');
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of ents) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    try { out.push({ folder: d.name, text: fs.readFileSync(path.join(dir, d.name, 'explain.md'), 'utf8') }); } catch { /* none */ }
  }
  return out;
}
