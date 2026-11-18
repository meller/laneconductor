// Phase 5d Task 1: the board data generator (connector/src/board.mjs, connector/bin/lc-board.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, git, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { blobSha } from '../src/blob.mjs';
import { buildBoard, sameBoard } from '../src/board.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const NOW = '2026-11-17T10:00:00.000Z';
const SENTINEL = 'SENTINEL-ZEBRA-7731-DO-NOT-LEAK';
const cleanup = [];
after(() => rm(...cleanup));

const run = (repo, ...args) => spawnSync('node', [BIN, '--repo', repo, ...(args.includes('--now') ? [] : ['--now', NOW]), ...args], { encoding: 'utf8' });

/** A fixture repo: AM- and legacy folders, archived folders, a broken marker, private files with a sentinel. */
function fixture() {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Fixture Project' } }));
  writeFile(dir, 'conductor/tracks/AM-123-new-thing/index.md', INDEX(123, 'New thing', { lane: 'plan', status: 'running', extra: '**Auto Run**: yes\n**Merge Mode**: pr\n**Depends On**: AM-100, 99\n' }));
  writeFile(dir, 'conductor/tracks/AM-123-new-thing/conversation.md', `# conversation\n${SENTINEL} from the conversation\n`);
  writeFile(dir, 'conductor/tracks/AM-123-new-thing/spec.md', `# spec\n${SENTINEL} from the spec\n`);
  writeFile(dir, 'conductor/tracks/AM-123-new-thing/plan.md', `# plan\n${SENTINEL} from the plan\n`);
  writeFile(dir, 'conductor/tracks/100-legacy-track/index.md', INDEX(100, 'Legacy track', { lane: 'done', status: 'success' }).replace('# Track AM-100:', '# Track 100:'));
  writeFile(dir, 'conductor/tracks/AM-124-second/index.md', INDEX(124, 'Second', { lane: 'plan', status: 'queue' }));
  writeFile(dir, 'conductor/tracks/AM-125-in-review/index.md', INDEX(125, 'In review', { lane: 'review', status: 'waiting', extra: '**Waiting for reply**: yes\n' }));
  writeFile(dir, 'conductor/tracks/AM-126-broken/index.md', '# Track AM-126: Broken one\n\n**Lane**: nowhere\n**Lane Status**: sideways\n');
  writeFile(dir, 'conductor/tracks/AM-127-no-index/spec.md', 'no index here\n');
  writeFile(dir, 'conductor/tracks/_duplicate-123-new-thing/index.md', INDEX(123, 'Old copy', { lane: 'plan', status: 'queue' }));
  writeFile(dir, 'conductor/tracks/_quarantine-9-garbled-20260901/index.md', INDEX(9, 'Garbled', { lane: 'bogus', status: 'bogus' }));
  writeFile(dir, 'conductor/tracks/manager/readme.md', 'not a track\n');
  commitAll(dir);
  return dir;
}

test('shape, ordering and counts on a fixture repo', () => {
  const dir = fixture();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const b = JSON.parse(r.stdout);
  assert.equal(b.project, 'Fixture Project');
  assert.equal(b.generated_at, NOW);
  assert.deepEqual(b.lanes, ['backlog', ...LANES]);
  // Lane order (backlog, plan, ..., done, then unknown lanes), number descending, folder name as the tie-break.
  assert.deepEqual(b.tracks.map((t) => t.folder), ['AM-124-second', 'AM-123-new-thing', '_duplicate-123-new-thing', 'AM-125-in-review', '100-legacy-track', 'AM-127-no-index', 'AM-126-broken', '_quarantine-9-garbled-20260901']);
  const by = Object.fromEntries(b.tracks.map((t) => [t.folder, t]));
  assert.deepEqual(by['AM-123-new-thing'], {
    number: 123, folder: 'AM-123-new-thing', title: 'New thing', lane: 'plan', lane_status: 'running', progress: 0, phase: 'New',
    depends_on: ['100', '99'], auto_run: true, merge_mode: 'pr', source_hash: blobSha(fs.readFileSync(path.join(dir, 'conductor/tracks/AM-123-new-thing/index.md'), 'utf8')).slice(0, 12), needs_attention: false,
    action: { c: null, w: 'running; nothing to do' },
  });
  assert.equal(by['100-legacy-track'].number, 100);
  assert.equal(by['100-legacy-track'].lane, 'done');
  assert.equal(by['100-legacy-track'].title, 'Legacy track');
  assert.equal(by['_duplicate-123-new-thing'].archived, true);
  assert.equal(by['_quarantine-9-garbled-20260901'].archived, true);
  assert.ok(!('manager' in by), 'a folder without a track number is not a track');
  assert.equal(by['AM-127-no-index'].lane, null);
  assert.equal(by['AM-127-no-index'].needs_attention, true);

  // Counts leave the archived folders out entirely.
  assert.deepEqual(b.counts.by_lane, { backlog: 0, plan: 2, implement: 0, review: 1, 'quality-gate': 0, done: 1, unknown: 2 });
  assert.equal(b.counts.archived, 2);
  assert.equal(b.counts.needs_attention, 3);
  assert.deepEqual(b.needs_attention.map((n) => n.number), [127, 126, 125]);
  const broken = b.needs_attention.find((n) => n.number === 126);
  assert.ok(broken.reasons.some((x) => x.includes('**Lane**')) && broken.reasons.some((x) => x.includes('**Lane Status**')), broken.reasons.join('|'));
  assert.ok(b.needs_attention.find((n) => n.number === 125).reasons.includes('waiting for a human reply'));
  assert.ok(!b.needs_attention.some((n) => n.folder.startsWith('_')), 'archived folders are not attention noise');
  assert.ok(!b.needs_attention.some((n) => n.number === 123), 'the archived copy does not make track 123 a duplicate');
});

test('tracks sort by lane order, then number descending', () => {
  const idx = (n, lane) => ({ folder: `AM-${n}-t`, index: { content: INDEX(n, `T${n}`, { lane }) } });
  const b = buildBoard([idx(1, 'done'), idx(2, 'plan'), idx(3, 'plan'), idx(4, 'review'), idx(5, 'backlog')], { lanes: LANES, generatedAt: NOW, project: 'p' });
  assert.deepEqual(b.tracks.map((t) => t.number), [5, 3, 2, 4, 1]);
});

test('odd and missing markers never throw', () => {
  const weird = [
    { folder: 'AM-1-a', index: { content: '' } },
    { folder: 'AM-2-b', index: { content: '**Lane**: \n**Progress**: lots\n**Depends On**: ???\n' } },
    { folder: 'AM-3-c', index: { content: '# Track AM-3: ok\n\n**Lane**: plan\n**Lane**: done\n**Lane Status**: queue\n' } },
    { folder: 'AM-4-d', index: null },
    { folder: 'AM-4-e', index: { content: INDEX(4, 'Dup four') } },
    null,
    { folder: 7 },
  ];
  const b = buildBoard(weird, { lanes: LANES, generatedAt: NOW });
  assert.equal(b.tracks.length, 5);
  assert.equal(b.project, null);
  const by = Object.fromEntries(b.tracks.map((t) => [t.folder, t]));
  assert.equal(by['AM-2-b'].progress, null);
  assert.deepEqual(by['AM-2-b'].depends_on, []);
  assert.equal(by['AM-3-c'].lane, 'plan', 'a repeated marker: the first one wins (Track AM-10139), it does not fold into the value above');
  assert.ok(!/\n/.test(by['AM-3-c'].lane));
  assert.ok(!b.needs_attention.some((n) => n.folder === 'AM-3-c'), 'the repeat is not a lint problem; get_track and list_tracks warn header_damaged');
  assert.ok(b.needs_attention.find((n) => n.folder === 'AM-4-d').reasons.some((x) => x.includes('no index.md')));
  assert.ok(b.needs_attention.find((n) => n.folder === 'AM-4-e').reasons.some((x) => x.includes('used by 2 folders')));
});

test('deterministic for a given generatedAt', () => {
  const dir = fixture();
  const a = run(dir, '--pretty').stdout;
  const b = run(dir, '--pretty').stdout;
  assert.equal(a, b);
  
  const later = run(dir, '--pretty', '--now', '2027-01-01T00:00:00Z').stdout;
  assert.notEqual(later, a, 'the stamp differs');
  assert.ok(sameBoard(JSON.parse(a), JSON.parse(later)));
  assert.equal(JSON.parse(later).generated_at, '2027-01-01T00:00:00Z');
});

test('privacy: no conversation, spec or plan text, and no Problem or Summary text, in the output', () => {
  const dir = fixture();
  writeFile(dir, 'conductor/tracks/AM-124-second/index.md', INDEX(124, 'Second', {}).replace('**Summary**:', `**Problem**: ${SENTINEL} problem\n**Summary**: ${SENTINEL} summary\n#`));
  const out = run(dir, '--pretty').stdout;
  assert.ok(out.length > 100);
  assert.ok(!out.includes(SENTINEL), 'sentinel leaked');
  assert.ok(!/Problem|summary text|from the (spec|plan|conversation)/i.test(out.replace(/"problem"/g, '')), 'file body text leaked');
  const b = JSON.parse(out);
  const keys = new Set(b.tracks.flatMap((t) => Object.keys(t)));
  assert.deepEqual([...keys].sort(), ['action', 'archived', 'auto_run', 'depends_on', 'folder', 'lane', 'lane_status', 'merge_mode', 'needs_attention', 'number', 'phase', 'progress', 'source_hash', 'title']);
});

test('privacy: a marker value never runs into the body (legacy index.md): Lane Status is one line, a title line ends a value', () => {
  const body = `# Track AM-5: Legacy\n\n**Lane**: done\n**Lane Status**: success\n\n# Notes\n${SENTINEL} body\n`;
  const b = buildBoard([{ folder: 'AM-5-legacy', index: { content: body } }], { lanes: LANES, generatedAt: NOW });
  assert.ok(!JSON.stringify(b).includes(SENTINEL), JSON.stringify(b));
  assert.equal(b.tracks[0].lane_status, 'success');
  assert.equal(b.tracks[0].phase, null);
  assert.equal(b.counts.needs_attention, 0, 'the value is "success", not "success" plus the body (Track AM-10139)');
});

test('--check passes on a fresh file, fails on a stale or missing one (generated_at is ignored)', () => {
  const dir = fixture();
  const out = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-board-out-'));
  cleanup.push(out);
  const file = path.join(out, 'board.json');
  assert.equal(run(dir, '--out', file).status, 0);
  assert.equal(run(dir, '--check', file, '--now', '2030-01-01T00:00:00Z').status, 0, 'a different stamp is not drift');
  writeFile(dir, 'conductor/tracks/AM-124-second/index.md', INDEX(124, 'Second', { lane: 'implement' }));
  const stale = run(dir, '--check', file);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /out of date/);
  const missing = run(dir, '--check', path.join(out, 'nope.json'));
  assert.equal(missing.status, 1);
  fs.writeFileSync(file, 'not json');
  assert.equal(run(dir, '--check', file).status, 1);
});

test('CLI prints valid JSON on stdout and writes nothing into the repo', () => {
  const dir = fixture();
  const before = git(dir, 'status', '--porcelain', '--ignored');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.equal(run(dir, '--pretty').status, 0);
  assert.equal(git(dir, 'status', '--porcelain', '--ignored'), before);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('falls back to the folder name and the default lanes without config files', () => {
  const dir = makeRepo({ workflow: false, files: { 'conductor/tracks/AM-1-x/index.md': INDEX(1, 'X') } });
  cleanup.push(dir);
  const b = JSON.parse(run(dir).stdout);
  assert.equal(b.project, path.basename(dir));
  assert.deepEqual(b.lanes, ['backlog', ...LANES]);
  assert.equal(b.counts.by_lane.plan, 1);
});

test('a bad --now exits 2 and a repo with no tracks gives an empty board', () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const bad = spawnSync('node', [BIN, '--repo', dir, '--now', 'yesterday-ish'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--now is not a date/);
  const b = JSON.parse(run(dir).stdout);
  assert.deepEqual(b.tracks, []);
  assert.equal(b.counts.needs_attention, 0);
});
