// Fixture projects for the `next` command (track AM-10144, Phase 6). Every fixture is built in a temporary directory with its OWN `git init`
// and one commit on `main`, so it can never resolve to an enclosing checkout. A fixture is a compact description:
//   { git: true, files: {}, commits: 1, conductor: 'full' | 'no-workflow' | 'none', workflow: 'default' | 'old', settings: '<json text>',
//     tracks: [{ n, lane, status, extra: { Marker: value }, plan: 'real' | 'realistic' | 'stub' | 'missing', comment: 'human' | 'system', branch: 'merged' | 'unmerged' | 'subject',
//                ageHours, slug, dup: true, connectorCommits: true }] }
// and carries `expect` (state id, track, command) for the reference classifier and the tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WORKFLOW_JSON } from './repo.mjs';

const G = (dir, env, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', ...env } }).trimEnd();

const OLD_WORKFLOW = JSON.stringify({ lanes: { planning: { on_success: 'in-progress:queue' }, 'in-progress': { on_success: 'review:queue' }, review: { on_success: 'quality-gate:queue' }, 'quality-gate': { on_success: 'done:queue' }, done: {} } }, null, 2);
// A workflow where implement and review do not move on by themselves.
const MANUAL_WORKFLOW = JSON.stringify({ lanes: { plan: { on_success: 'plan:success' }, implement: {}, review: {}, 'quality-gate': { on_success: 'done:queue' }, done: {} } }, null, 2);

const REAL_PLAN = '# Plan\n\n## Phase 1\n\n- [ ] Task 1.1: do the thing\n';
const STUB_PLAN = '# Plan\n\nPlan to be written in the plan lane.\n';
const REAL_TEST = '# Tests\n\n- [ ] TC-1: the thing works - expected: it does\n';
const STUB_TEST = '# Tests\n\n(Test cases to be added)\n';
// Track AM-10132: what a plan the plan lane really wrote looks like (phases, checked and unchecked tasks, prose around them), and the
// state a track made by newTrack is in (index.md only: no plan.md, no test.md).
const REALISTIC_PLAN = `# Track 10001: Add the export button

Written in the plan lane. Build the smallest slice first.

## Phase 1: The endpoint

- [x] Task 1.1: Add GET /export returning the rows as CSV
- [ ] Task 1.2: Page the result so a large table does not time out
  - [ ] Sub-task: cap the page size at 1000

## Phase 2: The button

- [ ] Task 2.1: Add the button to the table toolbar
- [ ] Task 2.2: Show a spinner while the file is prepared

## Notes

Use the existing CSV helper; do not add a dependency.
`;
const REALISTIC_TEST = `# Tests: Track 10001 - Add the export button

Test command: \`npm test\`

## Test Cases

### Phase 1: The endpoint

- [x] TC-1: GET /export returns a header row and one line per row - expected: 200 and text/csv
- [ ] TC-2: a table of 5000 rows is returned in pages - expected: no timeout

### Phase 2: The button

- [ ] TC-3: the button downloads the file - expected: a .csv with the visible columns
`;

export const pad = (n) => String(n);
export const folderOf = (t) => `AM-${t.n}-${t.slug ?? 'a-track'}`;

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function indexText(t) {
  const m = [['Lane', t.lane], ['Lane Status', t.status], ['Progress', '0%'], ...Object.entries(t.extra ?? {})];
  const lines = m.map(([k, v]) => `**${k}**: ${v}`);
  if (t.dupLane) lines.push(`**Lane**: ${t.dupLane}`, `**Lane Status**: ${t.status}`);
  return `# Track AM-${t.n}: Title ${t.n}\n\n${lines.join('\n')}\n**Summary**: summary of ${t.n}\n\n## Notes\n\nBody.\n`;
}

/** Builds the fixture; returns the directory. `date` is the base time (a Date) for the ages. */
export function buildFixture(desc, { now = Date.now() } = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-next-'));
  const isoAgo = (hours) => new Date(now - hours * 3600e3).toISOString();
  const identity = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const commit = (message, hours = 0) => {
    const d = isoAgo(hours);
    G(dir, { ...identity, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }, 'add', '-A');
    G(dir, { ...identity, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message);
  };
  for (const [rel, content] of Object.entries(desc.files ?? {})) write(dir, rel, content);
  if (desc.git === false) return dir;
  G(dir, {}, 'init', '-q', '-b', 'main');
  G(dir, {}, 'config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
  const conductor = desc.conductor ?? (desc.tracks ? 'full' : 'none');
  if (conductor !== 'none') {
    write(dir, 'conductor/code_styleguides/.gitkeep', '');
    if (conductor === 'full') {
      write(dir, 'conductor/workflow.json', { old: OLD_WORKFLOW, manual: MANUAL_WORKFLOW }[desc.workflow] ?? WORKFLOW_JSON);
      write(dir, 'conductor/tracks/.gitkeep', '');
    }
  }
  const staleSkill = () => {
    const at = path.join(dir, '.claude/skills/laneconductor');
    fs.mkdirSync(path.dirname(at), { recursive: true });
    if (desc.staleSkill === 'link') fs.symlinkSync('/nonexistent-home/.claude/skills/laneconductor', at);
    else write(dir, '.claude/skills/laneconductor/SKILL.md', '# old copy\n');
  };
  if (desc.staleSkill && desc.staleTracked) staleSkill();
  if (desc.settings !== undefined) write(dir, '.laneconductor.json', desc.settings);
  const wantsCommit = desc.commits !== 0 && (Object.keys(desc.files ?? {}).length || conductor !== 'none' || desc.commits);
  if (wantsCommit) commit('fixture: initial', 100);
  for (let i = 1; i < (desc.commits ?? 1); i += 1) commit(`fixture: change ${i}`, 99 - i * 0.01);
  for (const t of desc.tracks ?? []) {
    const f = `conductor/tracks/${folderOf(t)}`;
    write(dir, `${f}/index.md`, indexText(t));
    write(dir, `${f}/spec.md`, '# Spec\n\nSomething.\n');
    if (t.plan !== 'missing') {
      write(dir, `${f}/plan.md`, t.plan === 'stub' ? STUB_PLAN : t.plan === 'realistic' ? REALISTIC_PLAN : REAL_PLAN);
      write(dir, `${f}/test.md`, t.plan === 'stub' ? STUB_TEST : t.plan === 'realistic' ? REALISTIC_TEST : REAL_TEST);
    }
    if (t.comment) write(dir, `${f}/conversation.md`, t.comment === 'human' ? '> **human**: please decide\n' : '> **human**: please decide\n\n> **system**: done\n');
    commit(`chore(track-${t.n}): create_track index.md spec.md plan.md test.md via lc-connector`, t.ageHours ?? 1);
    if (t.connectorCommits) { commit(`chore(track-${t.n}): update_track index.md via lc-connector`, 0.9); commit(`chore(track-${t.n}): append_conversation via lc-connector`, 0.8); }
  }
  if (desc.staleSkill && !desc.staleTracked) staleSkill();
  for (const t of desc.tracks ?? []) {
    if (t.branch === 'merged') G(dir, {}, 'branch', `track-${t.n}`);
    if (t.branch === 'unmerged') {
      G(dir, {}, 'checkout', '-q', '-b', `track-${t.n}`);
      write(dir, `work-${t.n}.txt`, 'work\n');
      commit(`feat(track-${t.n}): work`, 0.5);
      G(dir, {}, 'checkout', '-q', 'main');
    }
    if (t.branch === 'subject') { write(dir, `merged-${t.n}.txt`, 'work\n'); commit(`feat(track-${t.n}): the work, merged`, 0.5); }
  }
  return dir;
}

const T = (n, lane, status, more = {}) => ({ n, lane, status, ...more });
const cmd = (name, n, tail = '') => `/laneconductor:${name} ${n}${tail}`.trim();
const REPO_FILES = { 'package.json': '{ "name": "demo" }\n', 'README.md': '# demo\n' };

/** One description per fixture of test.md (F01 to F26). `expect`: { state, track, command, also?, skipped?, blocked?, damaged?, level?, offers? }. */
export const FIXTURES = {
  F01: { desc: { git: false, files: { 'a.txt': 'x\n' } }, expect: { state: 'S01', command: '/laneconductor:setup' } },
  F02a: { desc: { files: REPO_FILES, commits: 40, conductor: 'none' }, expect: { state: 'S02', command: '/laneconductor:setup', default: 'continue', offers: ['laneconductor-parallel', 'laneconductor-board'] } },
  F02b: { desc: { files: {}, commits: 0, conductor: 'none' }, expect: { state: 'S02', command: '/laneconductor:new-project', default: 'new', offers: ['laneconductor-parallel', 'laneconductor-board'] } },
  F03: { desc: { conductor: 'no-workflow' }, expect: { state: 'S03', command: '/laneconductor:setup' } },
  F04: { desc: { conductor: 'full' }, expect: { state: 'S04', command: '/laneconductor:new <title>', level: 'explain', offers: ['laneconductor-parallel', 'laneconductor-board'] } },
  F05a: { desc: { tracks: [T(10001, 'plan', 'queue', { extra: { 'Waiting for reply': 'yes' } })] }, expect: { state: 'S05', track: 10001, command: '/laneconductor:comment 10001 <your answer>' } },
  F05b: { desc: { tracks: [T(10001, 'implement', 'waiting')] }, expect: { state: 'S05', track: 10001, command: '/laneconductor:comment 10001 <your answer>' } },
  F05c: { desc: { tracks: [T(10001, 'plan', 'queue', { comment: 'human' })] }, expect: { state: 'S05', track: 10001, command: '/laneconductor:comment 10001 <your answer>' } },
  F06a: { desc: { tracks: [T(10001, 'implement', 'failure')] }, expect: { state: 'S06', track: 10001, command: cmd('implement', 10001) } },
  F06b: { desc: { tracks: [T(10001, 'done', 'failure')] }, expect: { state: 'S06', track: 10001, command: cmd('merge', 10001) } },
  F07: { desc: { tracks: [T(10001, 'implement', 'running', { ageHours: 9 })] }, expect: { state: 'S07', track: 10001, command: '/laneconductor:move 10001 implement:queue' } },
  F08: { desc: { tracks: [T(10001, 'implement', 'running', { ageHours: 0.1 }), T(10002, 'plan', 'queue')] }, expect: { state: 'S18', track: 10002, command: cmd('plan', 10002), skipped: [{ track: 10001, state: 'S08' }] } },
  F09: { desc: { tracks: [T(10001, 'done', 'success'), T(10002, 'plan', 'waiting', { extra: { 'Waiting On Tracks': '10001' } })] }, expect: { state: 'S09', track: 10002, command: '/laneconductor:move 10002 plan:queue' } },
  F10: { desc: { tracks: [T(10001, 'done', 'queue'), T(10002, 'plan', 'waiting', { extra: { 'Waiting On Tracks': '10001' } })] }, expect: { state: 'S11', track: 10001, command: cmd('merge', 10001), blocked: [10002] } },
  F11: { desc: { tracks: [T(10001, 'done', 'queue', { branch: 'unmerged' })] }, expect: { state: 'S11', track: 10001, command: cmd('merge', 10001) } },
  F12: { desc: { tracks: [T(10001, 'done', 'queue', { branch: 'merged' })] }, expect: { state: 'S12', track: 10001, command: '/laneconductor:move 10001 done:success' } },
  F13: { desc: { tracks: [T(10001, 'done', 'waiting', { extra: { 'PR URL': 'https://example.invalid/pr/1' } })] }, expect: { state: 'S13', track: 10001, command: '/laneconductor:move 10001 done:success' } },
  F14: { desc: { tracks: [T(10001, 'quality-gate', 'queue')] }, expect: { state: 'S14', track: 10001, command: cmd('quality-gate', 10001) } },
  F15a: { desc: { tracks: [T(10001, 'review', 'queue')] }, expect: { state: 'S15', track: 10001, command: cmd('review', 10001) } },
  F15b: { desc: { workflow: 'manual', tracks: [T(10001, 'implement', 'success')] }, expect: { state: 'S15', track: 10001, command: cmd('review', 10001) } },
  F16a: { desc: { tracks: [T(10001, 'implement', 'queue')] }, expect: { state: 'S16', track: 10001, command: cmd('implement', 10001) } },
  F16b: { desc: { tracks: [T(10001, 'plan', 'success')] }, expect: { state: 'S16', track: 10001, command: cmd('implement', 10001) } },
  F17: { desc: { tracks: [T(10001, 'implement', 'queue', { plan: 'stub' })] }, expect: { state: 'S17', track: 10001, command: cmd('plan', 10001) } },
  // The scratch-project case of 2026-11-18: a real plan.md and test.md (phases, checkboxes, prose) is NOT a stub, so the step is implement (S16); a track
  // that has only its index.md (what newTrack leaves) has nothing to implement from, so the step is plan (S17).
  F16c: { desc: { tracks: [T(10002, 'implement', 'queue', { plan: 'realistic' })] }, expect: { state: 'S16', track: 10002, command: cmd('implement', 10002) } },
  F16d: { desc: { tracks: [T(10002, 'plan', 'success', { plan: 'realistic' })] }, expect: { state: 'S16', track: 10002, command: cmd('implement', 10002) } },
  F17b: { desc: { tracks: [T(10001, 'plan', 'queue'), T(10002, 'implement', 'queue', { plan: 'missing' })] }, expect: { state: 'S17', track: 10002, command: cmd('plan', 10002) } },
  F18: { desc: { tracks: [T(10001, 'plan', 'queue')] }, expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), level: 'explain' } },
  F19: { desc: { tracks: [T(10001, 'backlog', 'queue'), T(10002, 'backlog', 'queue'), T(10003, 'done', 'success')] }, expect: { state: 'S19', track: 10001, command: '/laneconductor:move 10001 plan:queue' } },
  F20: { desc: { tracks: [T(10001, 'done', 'success'), T(10002, 'done', 'success')] }, expect: { state: 'S20', command: '/laneconductor:new <title>' } },
  F21a: { desc: { tracks: [T(10001, 'plan', 'queue', { dupLane: 'implement' }), T(10002, 'plan', 'queue')] }, expect: { state: 'S18', track: 10002, command: cmd('plan', 10002), damaged: [10001] } },
  F21b: { desc: { tracks: [T(10001, 'plan', 'queue', { slug: 'first' }), T(10001, 'plan', 'queue', { slug: 'second' })] }, expect: { state: 'S21', command: null, damaged: [10001] } },
  F22: { desc: { workflow: 'old', tracks: [T(10001, 'planning', 'queue')] }, expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), lane: 'planning' } },
  F24: { desc: { settings: '{"next":{"level":"short"}}', tracks: [T(10001, 'plan', 'queue')] }, expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), level: 'short' } },
  F25: {
    desc: { tracks: [T(10001, 'plan', 'queue'), T(10002, 'plan', 'queue'), T(10003, 'implement', 'queue'), T(10004, 'implement', 'queue'), T(10005, 'implement', 'queue'), T(10006, 'backlog', 'queue'), T(10007, 'backlog', 'queue'), T(10008, 'backlog', 'queue'),
      T(10009, 'review', 'queue'), T(10010, 'quality-gate', 'queue'), T(10011, 'done', 'success'), T(10012, 'done', 'success')] },
    expect: { state: 'S14', track: 10010, command: cmd('quality-gate', 10010), level: 'short' },
  },
  F26: { desc: { tracks: [T(10001, 'plan', 'queue')] }, installed: ['laneconductor-parallel'], expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), offers: [] } },
  F27: { desc: { files: REPO_FILES, commits: 40, conductor: 'none' }, installed: ['laneconductor-parallel'], expect: { state: 'S02', command: '/laneconductor:setup', offers: ['laneconductor-board'] } },
  F29: { desc: { conductor: 'full', staleSkill: 'link' }, expect: { state: 'S04', command: '/laneconductor:new <title>', stale: { kind: 'link', tracked: false, remove: 'rm .claude/skills/laneconductor' } } },
  F30: { desc: { staleSkill: 'link', staleTracked: true, tracks: [T(10001, 'plan', 'queue')] }, expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), stale: { kind: 'link', tracked: true, remove: 'git rm .claude/skills/laneconductor' } } },
  F31: { desc: { staleSkill: 'folder', files: REPO_FILES, commits: 3, conductor: 'none' }, expect: { state: 'S02', command: '/laneconductor:setup', stale: { kind: 'folder', tracked: false, remove: 'rm -r .claude/skills/laneconductor' } } },
  F32: { desc: { tracks: [T(10100, 'plan', 'queue'), T(10101, 'plan', 'queue', { extra: { 'Part Of': '10100' } }), T(10102, 'done', 'success', { extra: { 'Part Of': '10100' } })] }, expect: { state: 'S18', track: 10101, command: cmd('plan', 10101), epics: [{ epic: 10100, done: 1, total: 2 }] } },
  // The connector's own commits (create_track, update_track, append_conversation) are state, not shipped work: a done:queue track in direct mode
  // whose only commits on the default branch are those is still to be merged (S11), not "looks merged" (S12).
  F33: { desc: { tracks: [T(10001, 'done', 'queue', { connectorCommits: true })] }, expect: { state: 'S11', track: 10001, command: cmd('merge', 10001) } },
  // Blocked is never the step, whatever the status: a queue track whose Depends On is unshipped is S10 (blocked), and the step is the other track.
  F34: { desc: { tracks: [T(10001, 'plan', 'queue'), T(10002, 'implement', 'queue', { extra: { 'Depends On': '10001' } })] }, expect: { state: 'S18', track: 10001, command: cmd('plan', 10001), blocked: [10002] } },
  // What a failure recommends (S06): implement retries implement; plan, review and quality-gate replan.
  F06c: { desc: { tracks: [T(10001, 'review', 'failure')] }, expect: { state: 'S06', track: 10001, command: cmd('plan', 10001) } },
  F06d: { desc: { tracks: [T(10001, 'plan', 'failure')] }, expect: { state: 'S06', track: 10001, command: cmd('plan', 10001) } },
  F28: { desc: { tracks: [T(10001, 'done', 'queue', { branch: 'subject' })] }, expect: { state: 'S12', track: 10001, command: '/laneconductor:move 10001 done:success' } },
};

/** F23, the ranking fixture, and its variants (a track removed, the priority marker removed). */
export const RANKING = (without = [], noPriority = false) => ({
  tracks: [
    T(10001, 'plan', 'queue'),
    T(10002, 'implement', 'queue'),
    T(10003, 'review', 'queue'),
    T(10004, 'done', 'queue', { branch: 'unmerged' }),
    T(10005, 'plan', 'queue', noPriority ? {} : { extra: { Priority: 'high' } }),
    T(10006, 'implement', 'failure'),
    T(10007, 'plan', 'waiting', { extra: { 'Waiting for reply': 'yes' } }),
    T(10008, 'plan', 'waiting', { extra: { 'Waiting On Tracks': '10001' } }),
  ].filter((t) => !without.includes(t.n)),
});
