// Track AM-10155: the EXPLAIN for agent work. Joins the track files and git (the boundaries) with the session transcripts (the numbers)
// and renders `explain.md`. Read only toward the repository and the transcripts; the caller writes the file.
// Numbers only: see explain-transcripts.mjs for what is kept from a transcript (never text).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTrack } from './tracks.mjs';
import { readRuns, readPlan, intervalsOfRun } from './explain-boundaries.mjs';
import { collectMessages } from './explain-transcripts.mjs';

// ---- The thresholds of the insight and of the recommendations (decisions D13, D16): constants, to be tuned on more tracks. ----
export const LONG_CONTEXT = 400000; // tokens of context at the first reply of a lane run in the main session
export const LOW_SUB_SHARE = 30; // percent of replies from sub-agents under which a long main session is flagged
export const MOSTLY_HUMAN = 80; // percent of wall time that was waiting for a person
export const SLOW_STEP_MS = 5 * 60000; // a slowest step at or above this is a permission-wait suspect
export const MECHANICAL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']; // tool kinds that are shell, read or file edits
export const MECHANICAL_SHARE = 80; // percent of tool calls that are mechanical for a phase to count as mechanical
export const MIN_TOOL_CALLS = 5; // fewer tool calls than this in a phase or lane run are too few to judge
export const SMALL_REPLY_OUTPUT = 400; // average output tokens per reply at or under which replies are small
export const BIG_REPLY_OUTPUT = 1500; // average output tokens per reply at or over which replies are big
export const THINKING_SHARE = 30; // percent of output tokens that are thinking, at or over which thinking is "much"

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
  return { responses: 0, tokens: ZERO(), tools: {}, sub: { responses: 0, output: 0 }, times: [], reads: new Map(), toolRuns: [], asks: [], firstMsg: null, firstSub: null, subFirst: new Map(), models: {}, efforts: {}, thinking: { tokens: 0, recorded: 0, output: 0 }, seq: [] };
}

const bump = (o, k, by = 1) => { o[k] = (o[k] ?? 0) + by; };
/** Phase 8 (D16, D17): replies by model, effort levels, thinking tokens and the order of tool calls. New fields only; no existing total reads them. */
function addUse(b, m) {
  bump(b.models, m.model ?? 'unknown');
  bump(b.efforts, m.effort ?? 'unknown');
  if (m.thinking !== null && m.thinking !== undefined) { b.thinking.tokens += m.thinking; b.thinking.recorded += 1; b.thinking.output += m.usage.output; }
  for (const t of m.tools) b.seq.push({ ts: t.ts, id: t.id, name: t.name });
}
function mergeUse(dst, src) {
  for (const [k, v] of Object.entries(src.models)) bump(dst.models, k, v);
  for (const [k, v] of Object.entries(src.efforts)) bump(dst.efforts, k, v);
  dst.thinking.tokens += src.thinking.tokens; dst.thinking.recorded += src.thinking.recorded; dst.thinking.output += src.thinking.output;
  dst.seq.push(...src.seq);
}

/** At most this many segments of a Path are shown (D17). */
export const PATH_SEGMENTS = 8;
/** The Path of a list of tool names in the order used: runs of the same kind joined ("Read x12, Bash x26, Write x2"), the first 8 segments, then ", ..." when cut. Names only. */
export function pathOf(names) {
  const segs = [];
  for (const nm of names) { const last = segs[segs.length - 1]; if (last && last.name === nm) last.n += 1; else segs.push({ name: nm, n: 1 }); }
  const shown = segs.slice(0, PATH_SEGMENTS).map((x) => `${x.name} x${x.n}`).join(', ');
  return segs.length > PATH_SEGMENTS ? `${shown}, ...` : shown;
}
const pathOfSeq = (seq) => pathOf([...seq].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.name));

/** The tier of a model id, read from the id: opus 3 above sonnet 2 above haiku 1; 0 when the id names none of them (a heuristic, not a measure of quality). */
export function tierOf(id) {
  const s = String(id);
  return /opus/.test(s) ? 3 : /sonnet/.test(s) ? 2 : /haiku/.test(s) ? 1 : 0;
}

function addMessage(b, m, results) {
  b.responses += 1;
  b.tokens.output += m.usage.output; b.tokens.fresh += m.usage.fresh; b.tokens.cacheCreated += m.usage.cacheCreated; b.tokens.cacheRead += m.usage.cacheRead;
  if (m.sub) { b.sub.responses += 1; b.sub.output += m.usage.output; }
  b.times.push(m.ts);
  addUse(b, m);
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
    models: sortedTools(b.models),
    efforts: sortedTools(b.efforts),
    thinking: b.thinking,
    path: pathOfSeq(b.seq),
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
      mergeUse(dst, src);
    });
  });
  const phases = [...phaseMap.values()].sort((a, b) => a.order - b.order).map((e) => ({ key: e.key, label: e.label, tasks: e.tasks, wallMs: e.wallMs, humanMs: e.humanMs, agentMs: e.wallMs - e.humanMs, responses: e.bucket.responses, tokens: e.bucket.tokens, tools: sortedTools(e.bucket.tools), sub: e.bucket.sub, models: sortedTools(e.bucket.models), efforts: sortedTools(e.bucket.efforts), thinking: e.bucket.thinking, path: pathOfSeq(e.bucket.seq) }));
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

const INSIGHT_LABEL = 'These are rule-based observations worked out by the script from the numbers below, not an opinion of a model. No prompt, message or file content is used.';
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
const ratioText = (read, written) => `${n(Math.round(read / written))} times the tokens written`;
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const biggest = (rows, key) => rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]);

/** The shared test of the insight and of the recommendations: a lane run that began in a long main session with few sub-agent replies. */
export const longMainSession = (x) => Boolean(x.responses) && x.firstContext >= LONG_CONTEXT && pctOf(x.sub.responses, x.responses) < LOW_SUB_SHARE;

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
    if (longMainSession(x)) look.push(`- The ${x.lane} run starting ${stamp(x.start)} began with ${n(x.firstContext)} tokens of context in the main session and only ${share}% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.`);
  }
  const bounds = runs.filter((x) => !x.claimed || x.open);
  if (bounds.length) look.push(`- ${plural(bounds.length, 'lane run has', 'lane runs have')} no claim commit or ${bounds.length === 1 ? 'was' : 'were'} never closed (${bounds.map((x) => x.lane).join(', ')}): ${bounds.length === 1 ? 'its time is an upper bound' : 'their times are upper bounds'}; claim the lane when starting it (set it to running).`);
  const repeated = sum(runs, 'repeatedReads');
  if (repeated) look.push(`- ${plural(repeated, 'repeated read', 'repeated reads')}: files read more than once in the same run.`);
  const gaps = sum(runs, 'gapsOver30');
  if (gaps) look.push(`- ${plural(gaps, 'gap', 'gaps')} of more than 30 minutes between messages.`);
  const slow = runs.flatMap((x) => x.slowest).sort((a, c) => c.ms - a.ms)[0];
  if (slow && slow.ms >= SLOW_STEP_MS) look.push(`- The slowest step was ${slow.tool} ${fmtMs(slow.ms)} at ${stamp(slow.at)} (a permission wait is included).`);
  L.push(...(look.length ? look : ['- Nothing unusual: none of the rules above fired.']), '');
  return L;
}

// ---- Model use and the Path (D16, D17): names, counts and numbers only. ----

const listOf = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${n(v)}`).join(', ');
const total = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const thinkingDetail = (t, replies) => (t.recorded ? `${n(t.tokens)} of ${n(t.output)} output tokens on the ${n(t.recorded)} of ${n(replies)} replies that record them (${pct(t.tokens, t.output)})` : `not recorded on any of the ${n(replies)} replies`);
const thinkingNote = (t, replies) => (t.recorded ? `thinking ${n(t.tokens)} of ${n(t.output)} output tokens (${pct(t.tokens, t.output)}, recorded on ${n(t.recorded)} of ${n(replies)} replies)` : 'thinking not recorded');

/** The lines under "Phases of the implement lane": one bullet per phase with replies, so no table row is added (the statistics read the table back). */
function phaseNotes(phases) {
  const L = [];
  for (const p of phases) {
    if (!p.responses) continue;
    const parts = [`replies by model ${listOf(p.models)}`, thinkingNote(p.thinking, p.responses), `effort ${listOf(p.efforts)}`];
    if (p.path) parts.push(`path ${p.path}`);
    L.push(`- ${p.label}: ${parts.join('; ')}`);
  }
  return L;
}

/** The `## Model use` section: the totals of all lane runs in a fixed format, which the project statistics read back (parseExplainExtras). */
function renderModelUse(r) {
  const models = {}; const efforts = {}; const th = { tokens: 0, recorded: 0, output: 0 };
  for (const x of r.runs) {
    for (const [k, v] of Object.entries(x.models)) models[k] = (models[k] ?? 0) + v;
    for (const [k, v] of Object.entries(x.efforts)) efforts[k] = (efforts[k] ?? 0) + v;
    th.tokens += x.thinking.tokens; th.recorded += x.thinking.recorded; th.output += x.thinking.output;
  }
  const replies = total(models);
  return ['## Model use', '', `- Replies by model (all lane runs): ${replies ? listOf(models) : 'none'} (${n(replies)} ${replies === 1 ? 'reply' : 'replies'})`, `- Thinking tokens: ${thinkingDetail(th, replies)}`, `- Effort levels seen: ${replies ? listOf(efforts) : 'none'}`, '', 'The model id, the thinking token count and the effort level are read from the numbers each reply records; "unknown" means the reply carries none, and a reply that does not record thinking tokens is not counted as zero. "synthetic" marks placeholder replies no model wrote.', ''];
}

// ---- The recommendations (decisions D15, D16): fixed rules over the numbers; each carries its evidence. No model, no content, tokens only. ----

const RECO_LABEL = 'These are rule-based suggestions worked out by the script from the numbers below, not an opinion of a model. Tokens only: no dollars and no promise of savings. The model tier is read from the model id (opus above sonnet above haiku), which is a heuristic, not a measure of quality.';
const TIER_NAME = ['unknown', 'haiku', 'sonnet', 'opus'];
const EFFORT_ORDER = ['low', 'medium', 'high'];

const mechanicalOf = (tools) => { const t = total(tools); const m = MECHANICAL_TOOLS.reduce((s, k) => s + (tools[k] ?? 0), 0); return { t, m, yes: t >= MIN_TOOL_CALLS && m * 100 >= MECHANICAL_SHARE * t }; };
const thinkingPct = (t) => (t.output ? Math.round((100 * t.tokens) / t.output) : 0);
const dominantModel = (models) => {
  let best = null;
  for (const [id, c] of Object.entries(models)) if (tierOf(id) > 0 && (!best || c > best[1] || (c === best[1] && id < best[0]))) best = [id, c];
  return best;
};
const dominantEffort = (efforts) => {
  let best = null;
  for (const [k, c] of Object.entries(efforts)) if (EFFORT_ORDER.includes(k) && (!best || c > best[1])) best = [k, c];
  return best ? best[0] : null;
};

/** The work units the model and effort rules look at: the phases of the implement lane, and every other lane run (or an implement run with no phases) as a whole. */
function unitsOf(r) {
  const units = [];
  const hasPhases = r.phases.length > 0;
  for (const x of r.runs) if (!(x.lane === 'implement' && hasPhases)) units.push({ lane: x.lane, name: `${x.lane} run starting ${stamp(x.start)}`, ...x, output: x.tokens.output });
  for (const p of r.phases) units.push({ lane: 'implement', name: p.label, ...p, output: p.tokens.output });
  return units;
}

/**
 * The recommendations of one track: { items: [{ rule, lane, text }], setup: [text], fired }. Pure: only numbers, lane names, phase names,
 * model ids (allow-listed by the reader) and tool names go in.
 */
export function recommend(r) {
  const items = [];
  const add = (rule, lane, text) => items.push({ rule, lane, text });
  for (const x of r.runs) {
    if (longMainSession(x)) add('where', x.lane, `Run the ${x.lane} run starting ${stamp(x.start)} in a sub-agent or a fresh session: it began with ${n(x.firstContext)} tokens of context (limit ${n(LONG_CONTEXT)}) and ${pctOf(x.sub.responses, x.responses)}% of its replies came from sub-agents (limit ${LOW_SUB_SHARE}%); a sub-agent starts near 50,000 tokens.`);
  }
  const lighter = new Set(); const larger = new Set(); const lowerEffort = new Set();
  const units = unitsOf(r);
  for (const u of units) {
    if (!u.responses) continue;
    const mech = mechanicalOf(u.tools);
    const avgOut = Math.round(u.output / u.responses);
    const dom = dominantModel(u.models);
    const tier = dom ? tierOf(dom[0]) : 0;
    const smallReplies = u.output <= SMALL_REPLY_OUTPUT * u.responses;
    const bigReplies = u.output >= BIG_REPLY_OUTPUT * u.responses;
    const th = u.thinking;
    const muchThinking = th.recorded > 0 && th.output > 0 && th.tokens * 100 >= THINKING_SHARE * th.output;
    if (mech.yes && smallReplies && tier === 3) {
      lighter.add(u.lane);
      add('lighter-model', u.lane, `${u.name}: use a model one tier down (sonnet) for this work or its sub-agent: ${pctOf(mech.m, mech.t)}% of ${n(mech.t)} tool calls were shell, read or file edits (limit ${MECHANICAL_SHARE}%) and replies were small (${n(avgOut)} tokens written per reply, limit ${n(SMALL_REPLY_OUTPUT)}), yet ${n(dom[1])} of ${n(u.responses)} replies ran on ${dom[0]}.`);
    }
    if (!mech.yes && tier === 1 && (bigReplies || muchThinking)) {
      larger.add(u.lane);
      add('larger-model', u.lane, `${u.name}: keep or use a larger model (sonnet or above) for this work: ${bigReplies ? `replies were big (${n(avgOut)} tokens written per reply, limit ${n(BIG_REPLY_OUTPUT)})` : `thinking was ${thinkingPct(th)}% of the output on the replies that record it (limit ${THINKING_SHARE}%)`} and it ran on ${dom[0]} (${n(dom[1])} of ${n(u.responses)} replies).`);
    }
    if (mech.yes) {
      const known = Object.entries(u.efforts).filter(([k]) => k !== 'unknown').reduce((s, [, v]) => s + v, 0);
      const allHigh = known > 0 && (u.efforts.high ?? 0) === known;
      if (muchThinking || allHigh) {
        lowerEffort.add(u.lane);
        const why = [];
        if (muchThinking) why.push(`thinking was ${thinkingPct(th)}% of the output tokens on the ${n(th.recorded)} replies that record it (limit ${THINKING_SHARE}%)`);
        if (allHigh) why.push(`effort was high on all ${n(known)} replies that record an effort`);
        add('lower-effort', u.lane, `${u.name}: use a lower effort for this mechanical work (${pctOf(mech.m, mech.t)}% of ${n(mech.t)} tool calls were shell, read or file edits): ${why.join(' and ')}.`);
      }
    }
  }
  const slow = r.runs.flatMap((x) => x.slowest).sort((a, c) => c.ms - a.ms)[0];
  if (slow && slow.ms >= SLOW_STEP_MS) add('allow-command', null, `Check whether the ${slow.tool} command that took ${fmtMs(slow.ms)} at ${stamp(slow.at)} (limit ${fmtMs(SLOW_STEP_MS)}) can be allowed in the permission settings so it does not wait for a click; a permission wait is included in the step time, so this is a suggestion to check.`);
  const unclaimed = r.runs.filter((x) => !x.claimed);
  if (unclaimed.length) add('claim', null, `Claim the lane when starting it (set it to running): ${n(unclaimed.length)} of ${n(r.runs.length)} lane runs have no claim commit (${[...new Set(unclaimed.map((x) => x.lane))].join(', ')}), so their time and tokens are inferred upper bounds.`);

  const setup = [];
  for (const lane of [...new Set(r.runs.map((x) => x.lane))]) {
    const runs = r.runs.filter((x) => x.lane === lane);
    const replies = runs.reduce((s, x) => s + x.responses, 0);
    if (!replies) { setup.push(`- ${lane}: no replies were found in this lane, so there is nothing to suggest`); continue; }
    const subReplies = runs.reduce((s, x) => s + x.sub.responses, 0);
    const where = runs.some(longMainSession) ? 'a sub-agent or a fresh session' : subReplies * 2 > replies ? 'a sub-agent (as before)' : 'the main session (as before)';
    const laneModels = {}; const laneEfforts = {};
    for (const x of runs) { for (const [k, v] of Object.entries(x.models)) laneModels[k] = (laneModels[k] ?? 0) + v; for (const [k, v] of Object.entries(x.efforts)) laneEfforts[k] = (laneEfforts[k] ?? 0) + v; }
    const dom = dominantModel(laneModels);
    const tier = lighter.has(lane) ? 'sonnet for the mechanical work (one tier down)' : larger.has(lane) ? 'sonnet or above where replies are big or thinking is heavy' : dom ? `${TIER_NAME[tierOf(dom[0])]} (as before)` : 'unknown (no recognised model id)';
    const eff = dominantEffort(laneEfforts);
    let effort = eff ? `${eff} (as before)` : 'unknown (no effort recorded)';
    if (lowerEffort.has(lane)) {
      const mech = {};
      for (const u of units.filter((v) => v.lane === lane && mechanicalOf(v.tools).yes)) for (const [k, v] of Object.entries(u.efforts)) mech[k] = (mech[k] ?? 0) + v;
      const cur = dominantEffort(mech) ?? eff ?? 'high';
      effort = `${EFFORT_ORDER[Math.max(0, EFFORT_ORDER.indexOf(cur) - 1)]} for the mechanical work (one level below ${cur})`;
    }
    setup.push(`- ${lane}: where to run: ${where}; model tier: ${tier}; effort: ${effort}`);
  }
  return { items, setup, fired: items.length };
}

/** The `## Recommendations` section of one track (lines, no trailing blank). The last line is a fixed-format count that the statistics read back. */
export function renderRecommendations(r) {
  const L = ['## Recommendations', '', RECO_LABEL, ''];
  const rec = recommend(r);
  if (!rec.fired) L.push('- No change suggested: none of the rules fired.', '');
  else L.push(...rec.items.map((i) => `- ${i.text}`), '', '**Suggested setup for the next run**', '', ...rec.setup, '');
  L.push(`Recommendation rules fired: ${rec.fired}`, '');
  return L;
}

/** The markdown of explain.md (the same text is printed). `now` is the generated time; it is the only line that differs between two runs on the same data. */
export function renderExplain(r, { now = r.generatedAt } = {}) {
  const L = [];
  L.push(`# Agent run: ${r.track.folder}`, '', ...renderInsight(r), ...renderRecommendations(r), '> Generated by lc-explain.mjs from session transcripts and git; do not edit by hand (it is overwritten on each run). Numbers only: no prompt, message or file content is read into it.', '');
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
    const notes = phaseNotes(r.phases);
    if (notes.length) L.push('', ...notes);
    L.push('', 'A phase runs from the previous plan tick (or the claim) to the tick of its last task; a `(HUMAN)` task is human time. Tasks ticked in the same commit share their stretch of time equally, because the commit does not say which took longer.', '');
  }
  for (const x of r.runs) {
    const tools = Object.entries(x.tools);
    if (!tools.length && !x.slowest.length && !x.responses) continue;
    L.push(`## Detail: ${x.lane} run starting ${stamp(x.start)}`, '');
    L.push(`- Tool calls by kind: ${tools.length ? tools.slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ') + (tools.length > 12 ? `, and ${tools.length - 12} more kinds` : '') : 'none'}`);
    L.push(`- Files read more than once: ${x.repeatedReads} repeated read${x.repeatedReads === 1 ? '' : 's'}`);
    L.push(`- Context of the first response of the run: ${n(x.firstContext)} tokens${x.subStarts.length ? `; ${x.subStarts.length} sub-agent run${x.subStarts.length === 1 ? '' : 's'} started with a median of ${n(median(x.subStarts))} tokens of context` : ''}`);
    if (x.asks.count) L.push(`- Questions put to the human (the AskUserQuestion tool): ${x.asks.count}, waited ${fmtMs(x.asks.ms)} in total (a note only; the Human column counts only the (HUMAN) tasks and the waiting status)`);
    if (x.responses) {
      L.push(`- Replies by model: ${listOf(x.models)}`);
      L.push(`- Thinking tokens: ${thinkingDetail(x.thinking, x.responses)}`);
      L.push(`- Effort levels seen: ${listOf(x.efforts)}`);
      if (x.path) L.push(`- Path (tool kinds in the order used): ${x.path}`);
    }
    L.push(`- Gaps of more than 30 minutes between messages: ${x.gapsOver30} (a note only)`);
    if (x.slowest.length) L.push(`- Slowest tool steps (call to result, so a permission wait is included): ${x.slowest.map((t) => `${t.tool} ${fmtMs(t.ms)} at ${stamp(t.at)}`).join('; ')}`);
    L.push('');
  }
  if (r.runs.length) L.push(...renderModelUse(r));
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

/**
 * What the statistics read back from the new sections of one explain.md (Phase 8): the model mix of all replies and the number of rules fired.
 * A separate reader, so parseExplain keeps returning exactly the tables. `null` for either when an older file has no such section.
 */
export function parseExplainExtras(text) {
  const t = String(text);
  let models = null;
  const m = /^- Replies by model \(all lane runs\): (.*) \(\d[\d,]* repl(?:y|ies)\)$/m.exec(t);
  if (m) {
    models = {};
    if (m[1] !== 'none') for (const part of m[1].split(', ')) { const mm = /^(\S+) ([\d,]+)$/.exec(part); if (mm) models[mm[1]] = parseN(mm[2]); }
  }
  const f = /^Recommendation rules fired: (\d+)$/m.exec(t);
  return { models, rulesFired: f ? Number(f[1]) : null };
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

/** How many tracks are listed under "Tracks where most rules fired". */
const TOP_TRACKS = 3;
/** How many models are listed in the model mix before "and N more". */
const TOP_MODELS = 6;

/** The `## Recommendations` of statistics.md across tracks (D18): the model mix of all replies, the share of lane runs with no claim commit, the tracks where most rules fired. */
function renderStatisticsRecommendations(parsed) {
  const L = ['## Recommendations', '', 'These are rule-based observations across tracks, worked out by the script from the explain.md files, not an opinion of a model. Tokens only: no dollars. A track whose explain.md was written before the model fields shows no model data until it is regenerated.', ''];
  if (!parsed.length) { L.push('- No track has statistics yet.', ''); return L; }
  const withModels = parsed.filter((p) => p.extras.models !== null);
  const mix = {};
  for (const p of withModels) for (const [k, v] of Object.entries(p.extras.models)) mix[k] = (mix[k] ?? 0) + v;
  const replies = total(mix);
  if (!withModels.length) L.push('- No track has model data yet: regenerate the explain.md files to get the model mix.');
  else {
    const list = Object.entries(mix).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = list.slice(0, TOP_MODELS).map(([k, v]) => `${k} ${n(v)} (${pct(v, replies)})`).join(', ');
    L.push(`- Model mix of all replies (${withModels.length} ${withModels.length === 1 ? 'track' : 'tracks'} with model data, ${n(replies)} replies): ${replies ? shown : 'none'}${list.length > TOP_MODELS ? `, and ${list.length - TOP_MODELS} more models` : ''}.`);
    const missing = parsed.length - withModels.length;
    if (missing) L.push(`- ${missing} ${missing === 1 ? 'track has' : 'tracks have'} no model data (an older explain.md).`);
  }
  const runs = parsed.flatMap((p) => p.runs);
  const unclaimed = runs.filter((r) => r.lane.includes('(no claim commit)')).length;
  L.push(`- Lane runs with no claim commit: ${n(unclaimed)} of ${n(runs.length)} (${pct(unclaimed, runs.length)}): claim the lane when starting it so its time is measured, not inferred.`);
  const withRules = parsed.filter((p) => p.extras.rulesFired !== null);
  const fired = withRules.filter((p) => p.extras.rulesFired > 0).sort((a, b) => b.extras.rulesFired - a.extras.rulesFired || a.folder.localeCompare(b.folder, undefined, { numeric: true }));
  if (!withRules.length) L.push('- No track has recommendations yet: regenerate the explain.md files.');
  else if (!fired.length) L.push('- No rule fired on any track.');
  else L.push(`- Tracks where most rules fired: ${fired.slice(0, TOP_TRACKS).map((p) => `${trackLabel(p.folder)} (${p.extras.rulesFired} ${p.extras.rulesFired === 1 ? 'rule' : 'rules'})`).join(', ')}${fired.length > TOP_TRACKS ? `, and ${fired.length - TOP_TRACKS} more` : ''}.`);
  L.push('');
  return L;
}

/**
 * The text of conductor/statistics.md from every track's explain.md: `items` is [{ folder, text }]. Finished tracks are included.
 */
export function renderStatistics(items, { now }) {
  const parsed = items.map((it) => ({ folder: it.folder, ...parseExplain(it.text), extras: parseExplainExtras(it.text) })).sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
  const L = ['# Agent run statistics', '', ...renderStatisticsInsight(parsed), ...renderStatisticsRecommendations(parsed), '> Generated by lc-explain.mjs from every track\'s explain.md; do not edit by hand. Numbers only.', '', `Generated: ${now}`, `Tracks with an explain.md: ${parsed.length}`, '', `> ${APPROX_NOTE}`, ''];
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
