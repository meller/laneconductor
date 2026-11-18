// The reference classifier of the `next` state table (track AM-10144, Phase 6): states S01 to S21 and the ranking rule, implemented over a
// fixture directory from files and read-only git, exactly as `ops/next.md` describes them. It is the ORACLE of the tests; nothing ships it
// (`next` itself is Markdown that an agent follows). The tests compare it with the table of `ops/next.md` (ids, commands, ranking order).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const STALE_HOURS = 6;
export const ADDONS_OFFERED = ['laneconductor-parallel', 'laneconductor-board'];
const ALIAS = { planning: 'plan', 'in-progress': 'implement', inprogress: 'implement' };
const STATUSES = ['queue', 'running', 'success', 'failure', 'waiting'];
const LANE_ORDER = { done: 0, 'quality-gate': 1, review: 2, implement: 3, plan: 4 };
const PRIORITY = { high: 0, normal: 1, low: 2 };

/** The command shape of every state, as ops/next.md writes it; `N` is the track number, `<lane>` the track's own lane name. */
export const SHAPES = {
  S01: ['/laneconductor:setup'],
  S02: ['/laneconductor:setup', '/laneconductor:new-project', '/laneconductor:help'],
  S03: ['/laneconductor:setup'],
  S04: ['/laneconductor:new <title>'],
  S05: ['/laneconductor:comment N <your answer>'],
  S06: ['/laneconductor:implement N', '/laneconductor:plan N', '/laneconductor:merge N'],
  S07: ['/laneconductor:move N <lane>:queue'],
  S08: [],
  S09: ['/laneconductor:move N <lane>:queue'],
  S10: [],
  S11: ['/laneconductor:merge N'],
  S12: ['/laneconductor:move N done:success'],
  S13: ['/laneconductor:move N done:success'],
  S14: ['/laneconductor:quality-gate N'],
  S15: ['/laneconductor:review N'],
  S16: ['/laneconductor:implement N'],
  S17: ['/laneconductor:plan N'],
  S18: ['/laneconductor:plan N'],
  S19: ['/laneconductor:move N plan:queue'],
  S20: ['/laneconductor:new <title>'],
  S21: [],
};
export const STATE_IDS = Object.keys(SHAPES);

const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) } }).trim();
  } catch { return null; }
};
const ok = (dir, ...args) => git(dir, ...args) !== null;
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

/** Header markers of an index.md: the lines `**Name**: value` before the first `## ` heading; the first one wins, a repeat of Lane marks damage. */
export function readMarkers(text) {
  const markers = {};
  let damaged = false;
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) break;
    const m = line.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] in markers) { if (m[1] === 'Lane' || m[1] === 'Lane Status') damaged = true; continue; }
    markers[m[1]] = m[2].trim();
  }
  return { markers, damaged };
}

const nums = (v) => (v ?? '').split(/[,\s]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean).map(Number);
const canon = (lane) => ALIAS[lane] ?? lane;

function readTracks(dir) {
  const root = path.join(dir, 'conductor/tracks');
  const folders = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^_(duplicate|quarantine)-/.test(e.name)).map((e) => e.name).sort();
  const tracks = folders.map((f) => {
    const idx = path.join(root, f, 'index.md');
    const { markers, damaged } = exists(dir, `conductor/tracks/${f}/index.md`) ? readMarkers(fs.readFileSync(idx, 'utf8')) : { markers: {}, damaged: true };
    const n = Number((f.match(/(\d{3,})/) ?? [])[1]);
    return { n, folder: f, rel: `conductor/tracks/${f}`, markers, damaged, rawLane: markers.Lane, lane: canon(markers.Lane), status: markers['Lane Status'] };
  });
  const count = new Map();
  for (const t of tracks) count.set(t.n, (count.get(t.n) ?? 0) + 1);
  for (const t of tracks) if (count.get(t.n) > 1) t.damaged = true;
  return tracks;
}

function workflowOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'conductor/workflow.json'), 'utf8')).lanes ?? {}; } catch { return {}; }
}

/** Where a lane's success goes by itself: true when it names another lane or another status (the track moves on without a person). */
function movesOn(lanes, rawLane, status) {
  const target = lanes[rawLane]?.[status === 'success' ? 'on_success' : 'on_failure'];
  if (!target) return false;
  const [l, s] = String(target).split(':');
  return canon(l) !== canon(rawLane) || (s !== undefined && s !== status);
}

const isStub = (dir, t, file, marker, pat) => {
  const p = path.join(dir, t.rel, file);
  if (!fs.existsSync(p)) return true;
  const text = fs.readFileSync(p, 'utf8');
  return text.includes(marker) || !pat.test(text);
};

function lastEntryIsHuman(dir, t) {
  const p = path.join(dir, t.rel, 'conversation.md');
  if (!fs.existsSync(p)) return false;
  const authors = [...fs.readFileSync(p, 'utf8').matchAll(/^> \*\*(\w+)\*\*:/gm)].map((m) => m[1]);
  return authors.length > 0 && authors[authors.length - 1] === 'human';
}

function ageHours(dir, t, now) {
  const folder = git(dir, 'log', '-1', '--format=%ct', '--', t.rel);
  const branch = git(dir, 'log', '-1', '--format=%ct', `track-${t.n}`);
  const ts = Math.max(Number(folder) || 0, Number(branch) || 0);
  return ts ? (now / 1000 - ts) / 3600 : Infinity;
}

function merged(dir, t, defaultBranch) {
  const hasBranch = git(dir, 'branch', '--list', `track-${t.n}`);
  if (hasBranch) return ok(dir, 'merge-base', '--is-ancestor', `track-${t.n}`, defaultBranch);
  return hasWorkCommit(dir, t, defaultBranch);
}
/** A commit with `(track-N)` that is not the commit that added the track's own folder. */
function hasWorkCommit(dir, t, defaultBranch) {
  const subjects = (git(dir, 'log', defaultBranch, '--grep', `(track-${t.n})`, '--format=%s') ?? '').split('\n').filter(Boolean);
  return subjects.some((s) => !/add the track$/.test(s));
}

const commandFor = (state, t) => {
  const n = t?.n;
  switch (state) {
    case 'S05': return `/laneconductor:comment ${n} <your answer>`;
    case 'S06': return t.lane === 'implement' ? `/laneconductor:implement ${n}` : t.lane === 'done' ? `/laneconductor:merge ${n}` : `/laneconductor:plan ${n}`;
    case 'S07': case 'S09': return `/laneconductor:move ${n} ${t.rawLane}:queue`;
    case 'S11': return `/laneconductor:merge ${n}`;
    case 'S12': case 'S13': return `/laneconductor:move ${n} done:success`;
    case 'S14': return `/laneconductor:quality-gate ${n}`;
    case 'S15': return `/laneconductor:review ${n}`;
    case 'S16': return `/laneconductor:implement ${n}`;
    case 'S17': case 'S18': return `/laneconductor:plan ${n}`;
    case 'S19': return `/laneconductor:move ${n} plan:queue`;
    default: return null;
  }
};

/** The level `auto` resolves to, the explicit argument, or the saved setting. */
export function resolveLevel(dir, { state, tracks = [], arg } = {}) {
  if (arg === 'explain' || arg === 'short') return arg;
  let saved = 'auto';
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, '.laneconductor.json'), 'utf8'))?.next?.level; if (['auto', 'explain', 'short'].includes(v)) saved = v; } catch { /* missing, unreadable or invalid: auto */ }
  if (saved !== 'auto') return saved;
  if (['S01', 'S02', 'S03', 'S04'].includes(state)) return 'explain';
  const advanced = tracks.filter((t) => ['review', 'quality-gate', 'done'].includes(t.lane)).length;
  return advanced < 3 ? 'explain' : 'short';
}

/**
 * Classifies a project. Returns { state, track, command, ranked: [{track, state}], skipped, blocked, damaged, level, offers, lane, default }.
 * `installed` lists the add-ons that are detected; `arg` is the argument of the command (explain, short or a track number); `now` is in ms.
 */
export function classify(dir, { installed = [], arg, now = Date.now() } = {}) {
  const offersFor = () => ADDONS_OFFERED.filter((a) => !installed.includes(a));
  const out = { state: null, track: undefined, command: null, ranked: [], skipped: [], blocked: [], damaged: [], offers: [], level: null };
  const done = (state, extra = {}) => { Object.assign(out, { state }, extra); out.level = resolveLevel(dir, { state, tracks: extra.allTracks ?? [], arg }); delete out.allTracks; return out; };

  if (!ok(dir, 'rev-parse', '--is-inside-work-tree')) return done('S01', { command: '/laneconductor:setup' });
  const hasHistory = ok(dir, 'rev-parse', '--verify', '-q', 'HEAD');
  const entries = fs.readdirSync(dir).filter((f) => f !== '.git');
  if (!exists(dir, 'conductor')) {
    const cont = hasHistory || entries.length > 0;
    return done('S02', { command: cont ? '/laneconductor:setup' : '/laneconductor:new-project', default: cont ? 'continue' : 'new', offers: offersFor() });
  }
  if (!exists(dir, 'conductor/workflow.json') || !exists(dir, 'conductor/tracks')) return done('S03', { command: '/laneconductor:setup', offers: offersFor() });
  const tracks = readTracks(dir);
  if (!tracks.length) return done('S04', { command: '/laneconductor:new <title>', offers: offersFor() });

  const lanes = workflowOf(dir);
  const knownLanes = new Set([...Object.keys(lanes).map(canon), 'backlog']);
  const defaultBranch = git(dir, 'symbolic-ref', '--short', 'HEAD') ?? 'main';
  const byNumber = new Map(tracks.map((t) => [t.n, t]));
  const shipped = (n) => { const d = byNumber.get(n); return !d || (d.lane === 'done' && d.status === 'success'); };

  const candidates = [];
  for (const t of tracks) {
    if (t.damaged || !t.lane || !knownLanes.has(t.lane) || !STATUSES.includes(t.status)) { out.damaged.push(t.n); continue; }
    if (t.lane === 'backlog' || (t.lane === 'done' && t.status === 'success')) continue;
    const deps = nums(t.markers['Waiting On Tracks']).length ? nums(t.markers['Waiting On Tracks']) : nums(t.markers['Depends On']);
    const unshipped = deps.filter((d) => !shipped(d));
    let state;
    if (t.markers['Waiting for reply'] === 'yes' || (t.status === 'waiting' && t.lane !== 'done' && !deps.length) || lastEntryIsHuman(dir, t)) state = 'S05';
    else if (t.status === 'failure') state = 'S06';
    else if (t.status === 'running') state = ageHours(dir, t, now) > STALE_HOURS ? 'S07' : 'S08';
    else if (unshipped.length) { out.blocked.push(t.n); continue; }
    else if (t.status === 'waiting' && t.lane !== 'done') state = deps.length ? 'S09' : 'S05';
    else if (t.lane === 'done' && t.status === 'queue') state = merged(dir, t, defaultBranch) ? 'S12' : 'S11';
    else if (t.lane === 'done' && t.status === 'waiting') state = 'S13';
    else if (t.lane === 'quality-gate' && t.status === 'queue') state = 'S14';
    else if (t.lane === 'review' && t.status === 'success' && !movesOn(lanes, t.rawLane, 'success')) state = 'S14';
    else if (t.lane === 'review' && t.status === 'queue') state = 'S15';
    else if (t.lane === 'implement' && t.status === 'success' && !movesOn(lanes, t.rawLane, 'success')) state = 'S15';
    else if ((t.lane === 'implement' && t.status === 'queue') || (t.lane === 'plan' && t.status === 'success')) {
      state = isStub(dir, t, 'plan.md', 'Plan to be written in the plan lane', /- \[[ x]\]/) || isStub(dir, t, 'test.md', '(Test cases to be added)', /TC-\d+/) ? 'S17' : 'S16';
    } else if (t.lane === 'plan' && t.status === 'queue') state = 'S18';
    else { out.damaged.push(t.n); continue; }
    candidates.push({ t, state });
  }

  const group = (s) => (s === 'S05' ? 0 : s === 'S06' || s === 'S07' ? 1 : s === 'S09' ? 2 : 3);
  const key = ({ t, state }) => [group(state), PRIORITY[(t.markers.Priority ?? 'normal').toLowerCase()] ?? 1, LANE_ORDER[t.lane] ?? 9, t.n];
  const cmpKeys = (a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const sorted = candidates.filter((c) => c.state !== 'S08').sort((a, b) => cmpKeys(key(a), key(b)));
  out.skipped = candidates.filter((c) => c.state === 'S08').map((c) => ({ track: c.t.n, state: 'S08' }));
  out.ranked = sorted.map((c) => ({ track: c.t.n, state: c.state }));
  const extra = { allTracks: tracks.filter((t) => t.lane) };

  if (arg && /^\d+$/.test(arg)) {
    const only = candidates.find((c) => c.t.n === Number(arg));
    if (only) return done(only.state, { track: only.t.n, command: commandFor(only.state, only.t), lane: only.t.rawLane, ...extra });
  }
  if (sorted.length) {
    const top = sorted[0];
    return done(top.state, { track: top.t.n, command: commandFor(top.state, top.t), lane: top.t.rawLane, ...extra });
  }
  const backlog = tracks.filter((t) => !t.damaged && t.lane === 'backlog').sort((a, b) => a.n - b.n);
  if (backlog.length) return done('S19', { track: backlog[0].n, command: commandFor('S19', backlog[0]), ...extra });
  if (out.damaged.length) return done('S21', { command: null, damaged: [...new Set(out.damaged)], ...extra });
  return done('S20', { command: '/laneconductor:new <title>', ...extra });
}
