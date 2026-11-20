// The `next` ranking and its 23 states, as shipped code (track AM-10115, the What's next panel). One implementation, two users: the
// board (`lc-board.mjs` puts the answer into board.json) and the tests (the 34 fixtures of the next test). The
// procedure an agent follows is `ops/next.md`; this file is that table and that ranking as a function, so the board gives the same
// answer as `/laneconductor:next`.
//
//   gatherFacts(repo)       read only: the project's files through the local store, and read-only git; no writes, no network
//   classifyFacts(facts)    pure: facts in, the state, the track, the command and the ranking out
//   nextCard(result, facts) pure: the card the board shows (headline, command, what, why, the others, the primer)
//
// Read only by construction: it claims no track, writes no marker, creates no file and pushes nothing.
import { kpiFocus, parseKpis } from './kpis.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalGitStore } from './store-local.mjs';
import { resolveStateBranch } from './state-branch.mjs';
import { parseMarkers, damagedHeaders, STATUSES } from './markers.mjs';
import { rowOf } from './summary.mjs';
import { dueDays, dueText, ownerFlags, todayOf } from './owner-steps.mjs';
import { isTrackFolder } from './tracks.mjs';
import { dependencyState } from './dependencies.mjs';
import { epicsOf } from './epics.mjs';
import { staleRunning, STALE_RUNNING_HOURS } from './claims.mjs';
import { guideLaneMap, nearestLane } from './vocabulary.mjs';
import { parseEntries } from './conversation.mjs';
import { resolveNext } from '../../conductor/services/workflow-transitions.mjs';

export const STALE_HOURS = STALE_RUNNING_HOURS;
/** The add-ons the front door offers (the plugin catalog of the generator names the same two). */
export const ADDONS_OFFERED = ['laneconductor-parallel', 'laneconductor-board'];

const GUIDES = ['plan', 'implement', 'review', 'quality-gate', 'done', 'backlog'];
const DEFAULT_LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const LANE_ORDER = { done: 0, 'quality-gate': 1, review: 2, implement: 3, plan: 4 };
const PRIORITY = { high: 0, normal: 1, low: 2 };
const ARCHIVE_RE = /^_(?:duplicate|quarantine)-/;
const lower = (s) => String(s ?? '').trim().toLowerCase();

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
  // Track AM-10147 (owner steps): a waiting track with an Owner Action, and a waiting track whose run window (KPI Check After) has ended.
  S22: ['/laneconductor:comment N <what you did>'],
  S23: ['/laneconductor:quality-gate N'],
};
export const STATE_IDS = Object.keys(SHAPES);

/** The lane primer: six short bullets, the same text as the `explain` primer of ops/next.md (a test compares them). */
export const PRIMER = [
  'There are five lanes: plan, implement, review, quality-gate, done. Each track sits in one lane.',
  'Plan writes the documents (spec, plan, test cases). Implement builds from the plan. Review and quality-gate judge the work and never fix it. Done merges it.',
  'There are five statuses: queue (waiting to start), running (someone is on it), success, failure, waiting (parked for a reply or for other tracks).',
  'done:queue means gated but not merged yet; done:success means it is in the main branch.',
  "A marker is a bold line at the top of a track's index.md (**Lane**: plan); it is the track's state, kept in git.",
  'The order is plan, implement, review, quality-gate, merge, so each step has something agreed to check against.',
];

// ---------------------------------------------------------------------------------------------------------------------------
// Gather: read only.
// ---------------------------------------------------------------------------------------------------------------------------

const isStub = (text, placeholder, pattern) => text === null || text.includes(placeholder) || !pattern.test(text);

/**
 * The facts of a repository, read through the local store. Nothing here is written, and no text of a document leaves it: the plan,
 * the test file and the conversation are reduced to three booleans.
 * @param {string} repo absolute path of the project
 * @param {{ now?: number, store?: LocalGitStore }} [opts] now in ms
 */
export async function gatherFacts(repo, { now = Date.now(), store } = {}) {
  const root = path.resolve(repo);
  const st = store ?? new LocalGitStore({ repo: root, stateBranch: resolveStateBranch(root).branch });
  const facts = { now, isRepo: false, hasHistory: false, hasEntries: false, hasConductor: false, hasWorkflow: false, hasTracksDir: false, workflow: null, savedLevel: 'auto', staleSkill: null, tracks: [] };
  facts.isRepo = await st.isRepo();
  const top = await st.listDir('.');
  facts.hasEntries = top.some((e) => e.name !== '.git');
  if (!facts.isRepo) return facts;
  facts.hasHistory = Boolean((await st.head()).commit);
  facts.hasConductor = top.some((e) => e.name === 'conductor' && e.type === 'dir');

  // The optional personal setting `next.level` and a project-level copy of the skill: both read only.
  const [settings] = [...(await st.readFiles(['.laneconductor.json'])).values()];
  try { const v = JSON.parse(settings?.content ?? '')?.next?.level; if (['auto', 'explain', 'short'].includes(v)) facts.savedLevel = v; } catch { /* missing, unreadable or invalid: auto */ }
  const skillRel = '.claude/skills/laneconductor';
  try {
    const lst = await fs.lstat(path.join(root, skillRel));
    const kind = lst.isSymbolicLink() ? 'link' : 'folder';
    const tracked = await st.isTracked(skillRel);
    facts.staleSkill = { kind, tracked, remove: tracked ? `git rm${kind === 'folder' ? ' -r' : ''} ${skillRel}` : kind === 'folder' ? `rm -r ${skillRel}` : `rm ${skillRel}` };
  } catch { /* no copy */ }

  if (!facts.hasConductor) return facts;
  const inside = await st.listDir('conductor');
  facts.hasTracksDir = inside.some((e) => e.name === 'tracks' && e.type === 'dir');
  // Track AM-10152: the KPIs and their focus, so a track that serves an active KPI is preferred (never a rank among KPIs).
  facts.kpis = parseKpis((await st.readFiles(['conductor/kpis.md'])).get('conductor/kpis.md')?.content);
  const wfFile = (await st.readFiles(['conductor/workflow.json'])).get('conductor/workflow.json');
  facts.hasWorkflow = wfFile !== null;
  try { facts.workflow = JSON.parse(wfFile?.content ?? ''); } catch { facts.workflow = null; }
  if (!facts.hasWorkflow || !facts.hasTracksDir) return facts;

  const laneNames = Object.keys(facts.workflow?.lanes ?? {});
  const g = guideLaneMap(GUIDES, laneNames.length ? laneNames : DEFAULT_LANES);
  const guideOf = (lane) => GUIDES.find((k) => g[k] && lower(g[k]) === lower(lane)) ?? (lower(lane) === 'backlog' ? 'backlog' : null);
  const folders = (await st.listDir('conductor/tracks')).filter((e) => e.type === 'dir' && !ARCHIVE_RE.test(e.name) && isTrackFolder(e.name)).map((e) => e.name);
  const merges = await st.branchMergeStates('track-');
  for (const folder of folders) {
    const rel = `conductor/tracks/${folder}`;
    const index = (await st.readFiles([`${rel}/index.md`])).get(`${rel}/index.md`);
    const row = rowOf(folder, index);
    const t = { folder, row, readable: Boolean(index), repeatedLane: false, planStub: false, testStub: false, lastHuman: false, activityHours: null, claim: null, merged: null };
    if (index) t.repeatedLane = damagedHeaders(index.content).some((d) => ['Lane', 'Lane Status'].includes(d.name));
    const lane = lower(row.lane);
    const status = lower(row.lane_status);
    const guide = guideOf(lane);
    const live = index && guide && guide !== 'backlog' && !(guide === 'done' && status === 'success');
    if (live) {
      const files = await st.readFiles([`${rel}/plan.md`, `${rel}/test.md`, `${rel}/conversation.md`]);
      const text = (name) => files.get(`${rel}/${name}`)?.content ?? null;
      t.planStub = isStub(text('plan.md'), 'Plan to be written in the plan lane', /- \[[ xX]\]/);
      t.testStub = isStub(text('test.md'), '(Test cases to be added)', /TC-\d+/);
      const entries = text('conversation.md') === null ? [] : parseEntries(text('conversation.md'));
      t.lastHuman = entries.length > 0 && entries[entries.length - 1].author === 'human';
    }
    if (live && status === 'running') {
      const stamp = Date.parse((parseMarkers(index.content).values['Run Started'] ?? '').trim());
      t.claim = { stamped: Number.isFinite(stamp), stale: staleRunning(index.content, now) !== null };
      const times = [await st.lastCommitTime({ rel }), await st.lastCommitTime({ ref: `track-${row.number}` })].filter((x) => x !== null);
      t.activityHours = times.length ? (now / 1000 - Math.max(...times)) / 3600 : null;
    }
    if (live && guide === 'done' && status === 'queue') {
      const branch = merges.get(`track-${row.number}`);
      // A branch says it by itself. With no branch, the state branch must hold a commit for the track that is not one of the
      // connector's own state commits (`chore(track-N): create_track|update_track|append_conversation ...`): those record the files, not shipped work.
      t.merged = branch !== undefined ? branch : (await st.commitSubjects(`(track-${row.number})`)).some((s) => !/^chore\(track-\d+\): (create_track|update_track|append_conversation)\b/.test(s));
    }
    facts.tracks.push(t);
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Classify: pure.
// ---------------------------------------------------------------------------------------------------------------------------

/** The level `auto` resolves to, the explicit argument, or the saved setting. `saved` is `auto`, `explain` or `short`. In S01 to S04 `auto` is `short`: the first card (ops/next.md, "The first card"); the full front door text is the explain level. */
export function resolveLevel({ saved = 'auto', state, tracks = [], arg } = {}) {
  if (arg === 'explain' || arg === 'short') return arg;
  if (saved !== 'auto') return saved;
  if (['S01', 'S02', 'S03', 'S04'].includes(state)) return 'short';
  const advanced = tracks.filter((t) => ['review', 'quality-gate', 'done'].includes(t.guide)).length;
  return advanced < 3 ? 'explain' : 'short';
}

/** The command of a state for one track, as ops/next.md writes it. `lane` is the track's own lane name, `guide` the lane guide it stands for. */
export function commandFor(state, n, { lane, guide } = {}) {
  switch (state) {
    case 'S05': return `/laneconductor:comment ${n} <your answer>`;
    case 'S06': return guide === 'implement' ? `/laneconductor:implement ${n}` : guide === 'done' ? `/laneconductor:merge ${n}` : `/laneconductor:plan ${n}`;
    case 'S07': case 'S09': return `/laneconductor:move ${n} ${lane}:queue`;
    case 'S11': return `/laneconductor:merge ${n}`;
    case 'S12': case 'S13': return `/laneconductor:move ${n} done:success`;
    case 'S14': return `/laneconductor:quality-gate ${n}`;
    case 'S15': return `/laneconductor:review ${n}`;
    case 'S16': return `/laneconductor:implement ${n}`;
    case 'S17': case 'S18': return `/laneconductor:plan ${n}`;
    case 'S19': return `/laneconductor:move ${n} plan:queue`;
    case 'S22': return `/laneconductor:comment ${n} <what you did>`;
    case 'S23': return `/laneconductor:quality-gate ${n}`;
    default: return null;
  }
}

/**
 * Classifies a project from its facts. Returns { state, track, command, ranked: [{ track, state, command }], skipped, blocked, damaged,
 * level, offers, lane, default, epics, stale }. `installed` lists the add-ons that are detected; `arg` is the argument of the command
 * (explain, short or a track number).
 */
export function classifyFacts(facts, { installed = [], arg } = {}) {
  const out = { state: null, track: undefined, command: null, ranked: [], skipped: [], blocked: [], damaged: [], offers: [], level: null, stale: facts.staleSkill ?? null };
  const offersFor = () => ADDONS_OFFERED.filter((a) => !installed.includes(a));
  const done = (state, extra = {}) => {
    const { allTracks = [], ...rest } = extra;
    Object.assign(out, { state }, rest);
    out.level = resolveLevel({ saved: facts.savedLevel, state, tracks: allTracks, arg });
    return out;
  };

  if (!facts.isRepo) return done('S01', { command: '/laneconductor:setup' });
  if (!facts.hasConductor) {
    const cont = facts.hasHistory || facts.hasEntries;
    return done('S02', { command: cont ? '/laneconductor:setup' : '/laneconductor:new-project', default: cont ? 'continue' : 'new', offers: offersFor() });
  }
  if (!facts.hasWorkflow || !facts.hasTracksDir) return done('S03', { command: '/laneconductor:setup', offers: offersFor() });
  if (!facts.tracks.length) return done('S04', { command: '/laneconductor:new <title>', offers: offersFor() });

  const laneNames = Object.keys(facts.workflow?.lanes ?? {});
  const lanes = laneNames.length ? laneNames : DEFAULT_LANES;
  const g = guideLaneMap(GUIDES, lanes);
  const guideOf = (lane) => GUIDES.find((k) => g[k] && lower(g[k]) === lower(lane)) ?? (lower(lane) === 'backlog' ? 'backlog' : null);
  const known = new Set([...lanes.map(lower), 'backlog']);
  const rows = facts.tracks.map((t) => t.row);
  const deps = dependencyState(rows);
  const count = new Map();
  for (const r of rows) count.set(r.number, (count.get(r.number) ?? 0) + 1);

  // Where a lane's success goes by itself: true when it names another lane or another status (the track moves on without a person).
  const movesOn = (lane) => {
    const r = resolveNext(facts.workflow ?? { lanes: {} }, lane, 'success', { mapLane: (name) => nearestLane(name, laneNames) });
    return Boolean(r.ok && r.next && !(lower(r.next.lane) === lower(r.lane) && lower(r.next.status) === 'success'));
  };

  const tracks = facts.tracks.map((t) => {
    const lane = lower(t.row.lane);
    return { t, n: t.row.number, lane, status: lower(t.row.lane_status), guide: guideOf(lane) };
  });
  const epics = epicsOf(rows);
  out.epics = epics.map(({ row, table }) => ({ epic: row.number, done: table.done, total: table.total }));
  const epicNumbers = new Set(epics.map((e) => e.row.number));

  const candidates = [];
  for (const c of tracks) {
    const { t, n, lane, status, guide } = c;
    if (epicNumbers.has(n)) continue; // an epic is not a candidate: its children are
    if (!t.readable || t.repeatedLane || count.get(n) > 1 || !t.row.lane || !known.has(lane) || !STATUSES.includes(status)) { out.damaged.push(n); continue; }
    if (guide === 'backlog' || (guide === 'done' && status === 'success')) continue;
    const dep = deps.get(n) ?? null;
    // Track AM-10147: an owner action is read BEFORE the reply state (its card names the action, not "answer a reply") and, like a reply, even when
    // a dependency is unmet: the owner can do it now. An ended run window is read before the park check below, which would call it a question.
    const flags = ownerFlags(t.row, facts.now);
    const parkedForOther = status === 'waiting' && guide !== 'done' && (!dep || (!dep.blocked_by.length && !dep.ready_to_resume));
    let state;
    if (status === 'waiting' && t.row.owner_action) state = 'S22';
    else if (flags.ready_to_measure && !t.row.waiting_for_reply && !t.lastHuman && !dep?.blocked_by.length) state = 'S23';
    else if (t.row.waiting_for_reply || t.lastHuman || parkedForOther) state = 'S05';
    else if (status === 'failure') state = 'S06';
    else if (status === 'running') {
      const aliveByGit = t.activityHours !== null && t.activityHours <= STALE_HOURS;
      const aliveByStamp = Boolean(t.claim?.stamped && !t.claim.stale);
      state = aliveByGit || aliveByStamp ? 'S08' : 'S07';
    } else if (dep?.blocked_by.length) { out.blocked.push(n); continue; }
    else if (dep?.ready_to_resume) state = 'S09';
    else if (guide === 'done' && status === 'queue') state = t.merged ? 'S12' : 'S11';
    else if (guide === 'done' && status === 'waiting') state = 'S13';
    else if (guide === 'quality-gate' && status === 'queue') state = 'S14';
    else if (guide === 'review' && status === 'success' && !movesOn(lane)) state = 'S14';
    else if (guide === 'review' && status === 'queue') state = 'S15';
    else if (guide === 'implement' && status === 'success' && !movesOn(lane)) state = 'S15';
    else if ((guide === 'implement' && status === 'queue') || (guide === 'plan' && status === 'success')) state = t.planStub || t.testStub ? 'S17' : 'S16';
    else if (guide === 'plan' && status === 'queue') state = 'S18';
    else { out.damaged.push(n); continue; }
    candidates.push({ c, state });
  }

  const group = (s) => (s === 'S22' ? 0 : s === 'S05' ? 1 : s === 'S06' || s === 'S07' ? 2 : s === 'S09' || s === 'S23' ? 3 : 4);
  // The owner actions come in the order of their due day (an overdue one is simply the oldest; a missing or malformed day is last); the rest of the key is the same.
  const key = ({ c, state }) => [group(state), ...(state === 'S22' ? [dueDays(c.t.row.owner_action_due)] : []), kpiRank(c.t.row), PRIORITY[lower(c.t.row.priority ?? 'normal')] ?? 1, LANE_ORDER[c.guide] ?? 9, c.n];
  // Active-KPI tracks first; a track with no KPI, or one that cannot be judged, keeps its place; a track serving only non-active KPIs comes after them.
  const kpiRank = (row) => { const f = kpiFocus(row.serves, facts.kpis); return f === 'active' ? 0 : f === 'future' ? 2 : 1; };
  const cmpKeys = (a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const cmdOf = ({ c, state }) => commandFor(state, c.n, { lane: c.lane, guide: c.guide });
  const sorted = candidates.filter((x) => x.state !== 'S08').sort((a, b) => cmpKeys(key(a), key(b)));
  out.skipped = candidates.filter((x) => x.state === 'S08').map((x) => ({ track: x.c.n, state: 'S08' }));
  out.ranked = sorted.map((x) => ({ track: x.c.n, state: x.state, command: cmdOf(x), guide: x.c.guide }));
  const extra = { allTracks: tracks.filter((c) => c.guide).map((c) => ({ guide: c.guide })) };
  // Track AM-10147: more than two open owner actions add one line of advice. Advice only: it never changes the order.
  const open = sorted.filter((x) => x.state === 'S22').length;
  const today = todayOf(facts.now);
  const owner = (x) => (x.state === 'S22' ? { owner: { action: x.c.t.row.owner_action, due: x.c.t.row.owner_action_due ?? null, reason: dueText(x.c.t.row, today), overdue: Boolean(ownerFlags(x.c.t.row, facts.now).overdue) } } : x.state === 'S23' ? { window: { check_after: x.c.t.row.kpi_check_after } } : {});
  if (open > 2) out.advice = `You have ${open} open owner actions: finish one before starting another.`;
  const pick = (x) => done(x.state, { track: x.c.n, command: cmdOf(x), lane: x.c.t.row.lane, guide: x.c.guide, ...owner(x), ...extra });

  if (arg && /^\d+$/.test(arg)) {
    const only = candidates.find((x) => x.c.n === Number(arg));
    if (only) return pick(only);
  }
  if (sorted.length) return pick(sorted[0]);
  const backlog = tracks.filter((c) => c.guide === 'backlog' && c.t.readable && !c.t.repeatedLane && count.get(c.n) === 1).sort((a, b) => a.n - b.n);
  if (backlog.length) return done('S19', { track: backlog[0].n, command: commandFor('S19', backlog[0].n), ...extra });
  if (out.damaged.length) return done('S21', { command: null, damaged: [...new Set(out.damaged)], ...extra });
  return done('S20', { command: '/laneconductor:new <title>', ...extra });
}

/** Gathers the facts of a repository and classifies it: the whole answer of `next` for one project. */
export async function classifyRepo(repo, { installed, arg, now } = {}) {
  return classifyFacts(await gatherFacts(repo, { now }), { installed, arg });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The card: what the board shows. Text lives here, once.
// ---------------------------------------------------------------------------------------------------------------------------

const CARD_MAX = { head: 120, cmd: 200, text: 300 };
const clip = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const MAX_OTHERS = 5;

/** A short word for the "also waiting" rows. */
const WORD = { S22: 'do the owner action', S23: 'measure the KPI', S05: 'answer a reply', S06: 'look at a failure', S07: 'check a claim', S09: 'resume', S11: 'merge', S12: 'record as shipped', S13: 'record as shipped', S14: 'quality gate', S15: 'review', S16: 'implement', S17: 'plan first', S18: 'plan' };

const FAILED_PLAN = 'The plan lane writes the spec, the plan and the test cases again, and no code.';
// Per state: [headline, what the command does, why it comes next]. `id` is the track id the card is about.
const TEXT = {
  S01: () => ['Set this folder up', 'Setup offers to start a git repository here first, then sets up the conductor folder.', 'LaneConductor keeps its state in git, and this folder is not a repository yet.'],
  S02: (id, r) => (r.default === 'new'
    ? ['Start a new project', 'A short interview, then the scaffold and a first track.', 'The folder is empty, so the interview gives it a shape before any track exists.']
    : ['Set LaneConductor up around this project', 'Setup reads the stack that is here, asks you to confirm, and writes the conductor files without overwriting anything.', 'There is no conductor folder yet, so there is nothing to plan or build against.']),
  S03: () => ['Finish the setup', 'Setup runs again and skips what already exists, adding only what is missing.', 'The conductor folder is only partly there: the workflow or the tracks folder is missing.'],
  S04: () => ['Create the first track', 'Creates a track: a folder with its markers, in the plan lane, waiting for its plan.', 'The project is set up and has no tracks, and all work starts from a track.'],
  S05: (id) => [`Answer track ${id}`, 'Adds your answer to the track\'s conversation; then moving the track on lets work resume.', 'A track waiting for a human reply comes before everything else: it cannot go on without one.'],
  S06: (id, r, c) => (c.guide === 'implement'
    ? [`Look at the failed track ${id}`, 'Runs the implement lane again, after you read the last comment.', 'A failure comes first: it will not move on by itself, and the build failed.']
    : c.guide === 'done'
      ? [`Look at the failed merge of ${id}`, 'Merges the track again once the cause is fixed.', 'A failure comes first: the merge did not go through.']
      : [`Look at the failed track ${id}`, FAILED_PLAN, 'A failure comes first: it will not move on by itself, and a failed lane starts over from its plan.']),
  S07: (id) => [`Check whether ${id} is still running`, 'Releases the claim, setting the status back to queue; do it only if nothing is still working on it.', 'The track says it is running, but nothing has been committed for hours.'],
  S09: (id) => [`Resume track ${id}`, 'Sets the track back to queue so its lane can run.', 'Everything it waited on has shipped.'],
  S11: (id) => [`Merge track ${id}`, 'Merges the track\'s branch into the main branch; the merge command asks before any merge or push.', 'It passed the quality gate and is not shipped yet.'],
  S12: (id) => [`Record track ${id} as shipped`, 'Marks the track done; the command asks you to confirm first.', 'Its work is already in the main branch, so only the record is missing.'],
  S13: (id) => [`Record track ${id} once its pull request is merged`, 'Marks the track done after the pull request is merged.', 'A pull request is open and waits for a person to merge it.'],
  S14: (id) => [`Run the quality gate on track ${id}`, 'Evaluates the work against the project\'s gate; it never fixes anything.', 'It is the last step before the merge.'],
  S15: (id) => [`Review track ${id}`, 'Reviews the implementation against the plan; it evaluates and never fixes.', 'Built work is judged before it reaches the gate.'],
  S16: (id) => [`Implement track ${id}`, 'Builds the track from its plan and test cases, then hands it to review.', 'The plan and the test cases are written, so nothing stops the build.'],
  S17: (id) => [`Plan track ${id} first`, FAILED_PLAN.replace(' again', ''), 'There is nothing to implement from: the plan or the test cases are missing or still empty.'],
  S18: (id) => [`Plan track ${id}`, 'The plan lane writes the spec, the plan and the test cases, and no code.', 'Nothing is built before the work is agreed and testable.'],
  S19: (id) => [`Start the parked track ${id}`, 'Moves it to the start of the plan lane.', 'Nothing else is waiting, and this is the oldest parked track.'],
  S20: () => ['Nothing is waiting', 'Creates a new track for the next piece of work.', 'Every track is shipped.'],
  S22: (id, r) => [
    `Do the owner action on track ${id}`,
    `Yours to do, not the agent's: "${clip(r.owner?.action, 150)}" The draft and its publish instructions are in the ## Draft section of the track's spec.md. When it is done, comment here and the run window starts.`,
    `${r.owner?.reason ?? 'no due date'}. The track waits for you and nothing else moves it.`,
  ],
  S23: (id, r) => [`Measure the KPI of track ${id}`, 'The quality gate reads the KPI from its source, or asks you for the number, and writes the readout; it never invents a number.', `The run window ended (KPI Check After ${clip(r.window?.check_after, 40)}), so the result can be read now.`],
  S21: (id) => [`Fix track ${id} by hand`, 'Its markers cannot be read: a repeated, missing or unknown lane or status. Keep one of each marker.', 'A track that cannot be read is never ranked above one that can.'],
};

/**
 * The card of the What's next panel, from a `classifyFacts` result and its facts.
 * @returns {{ s: string, head: string, cmd: string|null, what: string, why: string, n: number|null, others: { n: number, cmd: string|null, w: string }[], primer: string[] }}
 *   cmd is null when there is nothing to run (work is running, or the rest is blocked, or a track needs a hand fix); `what` then says why.
 */
export function nextCard(result, facts) {
  const idOf = new Map(facts.tracks.map((t) => [t.row.number, t.row.id]));
  let { state, track: n = null, command: cmd } = result;
  let [head, what, why] = TEXT[state](idOf.get(result.track) ?? '', result, { guide: result.guide ?? null });
  if (state === 'S20' && (result.skipped.length || result.blocked.length)) {
    // None is ready: the step is not a command. Say why, without counting tracks by number.
    cmd = null;
    head = 'Nothing is ready to start';
    what = result.skipped.length ? 'Work is running on a track; start nothing on it, and ask for a refresh when it finishes.' : 'The remaining tracks wait on tracks that are not shipped yet.';
    why = result.skipped.length && result.blocked.length ? 'Other tracks wait on work that is not shipped, so there is nothing to start.' : 'Nothing is ready to be planned, built, reviewed or merged.';
  }
  if (state === 'S21') { n = result.damaged[0] ?? null; [head, what, why] = TEXT.S21(idOf.get(n) ?? '', result, {}); }
  const others = result.ranked.slice(1, 1 + MAX_OTHERS).map((r) => ({ n: r.track, cmd: r.command ? clip(r.command, CARD_MAX.cmd) : null, w: WORD[r.state] ?? 'next' }));
  const more = Math.max(0, result.ranked.length - 1 - MAX_OTHERS);
  return {
    s: state,
    head: clip(head, CARD_MAX.head),
    cmd: cmd ? clip(cmd, CARD_MAX.cmd) : null,
    what: clip(what, CARD_MAX.text),
    why: clip(why, CARD_MAX.text),
    n,
    others,
    ...(more ? { more } : {}),
    ...(result.advice ? { advice: clip(result.advice, CARD_MAX.text) } : {}),
    primer: PRIMER.map((p) => clip(p, CARD_MAX.text)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The project's own plan (track AM-10144, Phase 11): the first-track card and the S20 card lead with the items of the plan documents.
// The procedure an agent follows is "The first-track card" and "What is still in the plan" of ops/next.md; these two pure functions are
// that reading and that comparison, so the rules are testable. Nothing is invented: every item is a line of the text it came from.
// ---------------------------------------------------------------------------------------------------------------------------

/** The plan documents, in the order they are looked for (docs/roadmap*.md and README sections on the roadmap, next steps, status, todo or what is missing follow). */
export const PLAN_FILES = ['docs/plan.md', 'PLAN.md', 'ROADMAP.md', 'TODO.md'];
const DONE_HEADING = /\b(done|shipped|completed|released|finished|history|changelog)\b/i;
const QUESTION_HEADING = /\b(decisions?|open|questions?|unresolved)\b/i;
const oneLine = (s) => clip(s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim(), 100);

/**
 * The items and the open questions of one plan document. Items, in the file's own order: the unticked checkboxes, else the bullet or numbered lines,
 * else the `###` headings, of the sections that are not about what is done. A decision or question still open (under a heading with "decision",
 * "open", "question" or "unresolved", or a line ending in "?") is a question, never an item. A ticked, struck-through or "done" line is skipped.
 * @returns {{ items: string[], questions: string[] }}
 */
export function planItems(text) {
  const boxes = []; const bullets = []; const heads = []; const questions = [];
  let skip = false; let ask = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(raw);
    if (h) {
      const heading = h[2];
      skip = DONE_HEADING.test(heading); ask = QUESTION_HEADING.test(heading);
      if (h[1].length === 3 && !skip && !ask) (/\?\s*$/.test(heading) ? questions : heads).push(oneLine(heading));
      continue;
    }
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*\S)\s*$/.exec(raw);
    if (!m || skip) continue;
    const body = m[2];
    if (m[1] && /x/i.test(m[1])) continue;
    if (/^~~.*~~$/.test(body) || /\b(done|shipped)\b\s*[.)]?$/i.test(body)) continue;
    if (ask || /\?\s*$/.test(body)) { questions.push(oneLine(body)); continue; }
    (m[1] ? boxes : bullets).push(oneLine(body));
  }
  return { items: boxes.length ? boxes : bullets.length ? bullets : heads, questions };
}

const wordsOf = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4));
/**
 * Whether a plan item already has a track, compared conservatively on plain text (lower case, no punctuation or digits, words of four letters or more):
 * `has` when all the item's words are in one track's title and problem; `maybe` ("may already be a track") when at least half of the item's words are
 * in one, or all of a track title's words are in the item; else `none`. `tracks` are `{ title, problem }`.
 */
export function planCoverage(item, tracks) {
  const words = wordsOf(item);
  if (!words.size) return 'none';
  let best = 'none';
  for (const t of tracks) {
    const title = wordsOf(t.title);
    const all = new Set([...title, ...wordsOf(t.problem)]);
    const inAll = [...words].filter((w) => all.has(w)).length;
    if (inAll === words.size) return 'has';
    if (inAll * 2 >= words.size || (title.size && [...title].every((w) => words.has(w)))) best = 'maybe';
  }
  return best;
}
