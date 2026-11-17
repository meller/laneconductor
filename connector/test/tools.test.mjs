// Phase 3 (TC-3.x): the stdio server, driven through the SDK's own client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, readFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { blobSha } from '../src/blob.mjs';
import { parseConversationComments } from '../../conductor/sync-conversation-utils.mjs';
import { parseMarkers } from '../src/markers.mjs';
import { INSTRUCTIONS_LIMIT } from '../src/instructions.mjs';

const CONNECTOR_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const fixture = (opts) => {
  const dir = makeRepo(opts);
  cleanup.push(dir);
  return dir;
};
const open = async (dir, opts) => {
  const s = await connect(dir, opts);
  sessions.push(s);
  return s;
};
// The advice log is appended on every call and rides along with the next commit (D3-a), so state checks skip it.
const EXCLUDE_LOG = ':(exclude)conductor/advice-log';
const hashObject = (content) => execFileSync('git', ['hash-object', '--stdin'], { input: content }).toString().trim();
const T = (n, slug) => `conductor/tracks/AM-${n}-${slug}`;
const seed = (dir) => {
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  writeFile(dir, `${T(1, 'one')}/spec.md`, '# Spec one\n');
  writeFile(dir, `${T(1, 'one')}/plan.md`, '# Plan one\n');
  writeFile(dir, `${T(2, 'two')}/index.md`, INDEX(2, 'Two', { lane: 'implement', status: 'running' }));
  writeFile(dir, `${T(3, 'three')}/index.md`, INDEX(3, 'Three', { lane: 'done', status: 'success' }));
  commitAll(dir, 'fixture: tracks');
};

// TC-3.1
test('tools/list returns exactly the 8 v0 tools plus help, with the spec annotations', async () => {
  const s = await open(fixture());
  const { tools } = await s.client.listTools();
  const want = {
    list_tracks: [true, false], get_track: [true, false], get_context: [true, false],
    health_report: [true, false], create_track: [false, false], update_track: [false, true], append_conversation: [false, false], report_outcome: [false, false], help: [true, false],
  };
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(want).sort());
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, want[t.name][0], t.name);
    assert.equal(t.annotations.destructiveHint, want[t.name][1], t.name);
    assert.equal(typeof t.description, 'string');
  }
});

// TC-3.2
test('server instructions: present, within the limit, first 300 characters mention planning tracks and get_context', async () => {
  const s = await open(fixture());
  const ins = s.client.getInstructions();
  assert.ok(ins && ins.length <= INSTRUCTIONS_LIMIT, `length ${ins?.length}`);
  const head = ins.slice(0, 300);
  assert.match(head, /plan/i);
  assert.match(head, /track/i);
  assert.match(head, /get_context/);
  assert.match(ins, /report_outcome/);
  assert.match(ins, /health_report/);
});

// TC-3.3
test('every result, success and error, has structuredContent.provenance and starts its text with the provenance line', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  for (const [name, args] of [['list_tracks', {}], ['get_track', { track: '1' }], ['get_track', { track: '99999' }], ['get_context', {}], ['get_context', { files: ['nope.md'] }]]) {
    const r = await s.call(name, args);
    assert.ok(r.env.provenance, `${name} has provenance`);
    assert.equal(r.text.split('\n')[0], r.env.provenance.line, name);
    assert.match(r.env.provenance.line, /^LaneConductor state as of [0-9a-f]{7} on main \(local/);
    assert.equal(r.env.ok, !r.isError);
  }
  const e = await s.call('get_track', { track: '99999' });
  assert.equal(e.isError, true);
  assert.equal(e.env.error.code, 'TRACK_NOT_FOUND');
});

// TC-3.4
test('list_tracks: done hidden by default, include_done, lane filter, duplicate-number warning', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const def = await s.call('list_tracks');
  assert.deepEqual(def.env.data.tracks.map((t) => t.number), [2, 1]);
  assert.equal(def.env.data.total, 2);
  const all = await s.call('list_tracks', { include_done: true });
  assert.deepEqual(all.env.data.tracks.map((t) => t.number), [3, 2, 1]);
  const impl = await s.call('list_tracks', { lane: 'implement' });
  assert.deepEqual(impl.env.data.tracks.map((t) => t.id), ['AM-2']);
  assert.equal(impl.env.data.tracks[0].lane_status, 'running');
  assert.equal(impl.env.data.tracks[0].progress, 0);
  const q = await s.call('list_tracks', { query: 'THREE', include_done: true });
  assert.deepEqual(q.env.data.tracks.map((t) => t.number), [3]);
  writeFile(dir, `${T(2, 'dup')}/index.md`, INDEX(2, 'Dup'));
  const dup = await s.call('list_tracks', { include_done: true });
  assert.ok(dup.env.warnings.some((w) => /Duplicate track number 2/.test(w)), JSON.stringify(dup.env.warnings));
});

test('list_tracks: tracks without a Lane marker produce a warning; a non-LaneConductor repo is NOT_A_LANECONDUCTOR_REPO', async () => {
  const dir = fixture();
  writeFile(dir, `${T(5, 'bare')}/index.md`, '# Track AM-5: Bare\n\nno markers\n');
  commitAll(dir);
  const s = await open(dir);
  const r = await s.call('list_tracks');
  assert.ok(r.env.warnings.some((w) => /AM-5-bare.*no \*\*Lane\*\*/.test(w)));
  const plain = fixture({ workflow: false, files: {} });
  rm(path.join(plain, 'conductor'));
  git(plain, 'add', '-A');
  git(plain, 'commit', '-q', '-m', 'drop conductor');
  const s2 = await open(plain);
  const e = await s2.call('list_tracks');
  assert.equal(e.isError, true);
  assert.equal(e.env.error.code, 'NOT_A_LANECONDUCTOR_REPO');
});

// TC-3.5
test('get_track returns base with git-hash-object shas and the parsed markers', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const r = await s.call('get_track', { track: 'AM-1' });
  const { base, files, track } = r.env.data;
  assert.equal(base.commit, git(dir, 'rev-parse', 'HEAD'));
  for (const n of ['index', 'spec', 'plan']) assert.equal(base.files[n], hashObject(readFile(dir, `${T(1, 'one')}/${n}.md`)), n);
  assert.equal(base.files.test, null, 'a file that does not exist is null in base');
  assert.equal(base.files.conversation, null);
  assert.equal(files.test, null);
  assert.deepEqual(base.markers, parseMarkers(readFile(dir, `${T(1, 'one')}/index.md`)).values);
  assert.equal(track.title, 'One');
  assert.equal(track.id, 'AM-1');
  assert.equal(files.spec.content, '# Spec one\n');
});

test('get_track: asking for fewer files leaves the others out of base.files, markers always present', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const r = await s.call('get_track', { track: '1', files: ['plan'] });
  assert.deepEqual(Object.keys(r.env.data.base.files), ['plan']);
  assert.ok(r.env.data.base.markers['Lane']);
  assert.equal(r.env.data.conversation, null);
});

// TC-3.6
test('get_track with an 80,000-character conversation: text <= 40,000, conversation truncated first, spec/plan full and in base', async () => {
  const dir = fixture();
  seed(dir);
  const turns = [];
  for (let i = 0; i < 80; i++) turns.push(`> **claude**: entry ${i} ${'x'.repeat(1000)}`);
  writeFile(dir, `${T(1, 'one')}/conversation.md`, `# C\n\n${turns.join('\n\n')}\n`);
  const s = await open(dir);
  const r = await s.call('get_track', { track: '1', conversation_tail: 100 });
  assert.ok(r.text.length <= 40_000, `text is ${r.text.length}`);
  const d = r.env.data;
  assert.equal(d.conversation.truncated, true);
  assert.ok(d.conversation.entries.length < 80 && d.conversation.entries.length > 0);
  assert.equal(d.conversation.total, 80);
  assert.match(d.conversation.entries.at(-1).body, /^entry 79 /, 'newest entries are kept');
  assert.equal(d.files.spec.truncated, false);
  assert.ok(d.base.files.spec && d.base.files.plan);
});

test('get_track: an oversized spec is truncated, flagged, and absent from base.files so it cannot be overwritten (REQ-6)', async () => {
  const dir = fixture();
  seed(dir);
  writeFile(dir, `${T(1, 'one')}/spec.md`, `# Big\n${'y'.repeat(60_000)}\n`);
  commitAll(dir);
  const s = await open(dir);
  const r = await s.call('get_track', { track: '1' });
  assert.ok(r.text.length <= 40_000);
  assert.equal(r.env.data.files.spec.truncated, true);
  assert.ok(!('spec' in r.env.data.base.files));
  assert.ok('plan' in r.env.data.base.files);
  const w = await s.call('update_track', { track: '1', base: r.env.data.base, files: { spec: '# replaced\n' } });
  assert.equal(w.isError, true);
  assert.equal(w.env.error.code, 'BASE_MISSING_FILE');
  assert.match(readFile(dir, `${T(1, 'one')}/spec.md`), /^# Big/);
});

// TC-3.7
test('create_track makes XX-NNN-slug with five files, valid markers, one commit, and a base usable by update_track', async () => {
  const dir = fixture();
  const s = await open(dir);
  const before = Number(git(dir, 'rev-list', '--count', 'HEAD'));
  const c = await s.call('create_track', { title: 'Add CSV export', problem: 'Users need CSV export of the report page.', track_kind: 'feature' });
  assert.equal(c.isError, false, c.text);
  const d = c.env.data;
  assert.equal(d.track.folder, 'XX-1-add-csv-export');
  const folder = path.join(dir, 'conductor/tracks', d.track.folder);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['conversation.md', 'index.md', 'plan.md', 'spec.md', 'test.md']);
  const m = parseMarkers(fs.readFileSync(path.join(folder, 'index.md'), 'utf8')).values;
  assert.equal(m['Lane'], 'plan');
  assert.equal(m['Lane Status'], 'queue');
  assert.equal(Number(git(dir, 'rev-list', '--count', 'HEAD')), before + 1);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), d.commit.sha);
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^chore\(track-1\): create_track .* via lc-connector$/);
  assert.match(git(dir, 'log', '-1', '--format=%b'), /Surface: connector-test/);
  assert.equal(parseConversationComments(fs.readFileSync(path.join(folder, 'conversation.md'), 'utf8')).length, 0);
  const u = await s.call('update_track', { track: d.track.number, base: d.base, files: { plan: '# Plan\n- [ ] a\n' } });
  assert.equal(u.isError, false, u.text);
  assert.equal(readFile(dir, `conductor/tracks/${d.track.folder}/plan.md`), '# Plan\n- [ ] a\n');
  const second = await s.call('create_track', { title: 'Second', problem: 'p' });
  assert.equal(second.env.data.track.folder, 'XX-2-second');
});

test('create_track with track_kind bug writes the bug form and a regression-test first case (10116)', async () => {
  const dir = fixture();
  const s = await open(dir);
  const c = await s.call('create_track', { title: 'Export is broken', problem: 'The export button does nothing.', track_kind: 'bug' });
  assert.equal(c.isError, false, c.text);
  const spec = readFile(dir, `conductor/tracks/${c.env.data.track.folder}/spec.md`);
  assert.match(spec, /## Problem Statement\n\nThe export button does nothing\.\n\n## Symptom\n/);
  assert.match(spec, /## Steps to reproduce[\s\S]*## Expected result[\s\S]*## Actual result[\s\S]*## Suspected area[\s\S]*## Environment/);
  assert.match(readFile(dir, `conductor/tracks/${c.env.data.track.folder}/test.md`), /TC-1 \(regression\)/);
});

test('create_track: number follows the max of both conventions and reuses the common initials', async () => {
  const dir = fixture();
  writeFile(dir, 'conductor/tracks/999-canary/index.md', INDEX(999, 'Canary'));
  writeFile(dir, `${T(10105, 'x')}/index.md`, INDEX(10105, 'X'));
  commitAll(dir);
  const s = await open(dir);
  const c = await s.call('create_track', { title: 'Next', problem: 'p', author_initials: 'zz' });
  assert.equal(c.env.data.track.folder, 'ZZ-10106-next');
  await s.call('create_track', { title: 'Again', problem: 'p', author_initials: 'zz' });
  const c3 = await s.call('create_track', { title: 'Later', problem: 'p' });
  assert.equal(c3.env.data.track.folder, 'ZZ-10108-later', 'initials default to the most common prefix');
});

test('create_track: a problem that would break index.md is VALIDATION_FAILED and writes nothing', async () => {
  const dir = fixture();
  const s = await open(dir);
  const before = git(dir, 'rev-parse', 'HEAD');
  const r = await s.call('create_track', { title: 'Bad', problem: 'ok\n## Heading' });
  assert.equal(r.env.error.code, 'VALIDATION_FAILED');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), before);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'conductor/tracks')), ['.gitkeep']);
});

// TC-3.8 / 3.9
test('update_track with a fresh base writes and commits and returns a new base; reusing the old base is a CONFLICT that leaves the first edit', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const g = await s.call('get_track', { track: '1' });
  const old = g.env.data.base;
  const a = await s.call('update_track', { track: '1', base: old, files: { plan: '# Plan A\n' } });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.env.data.commit.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(a.env.data.base.files.plan, blobSha('# Plan A\n'));
  assert.equal(a.env.data.base.commit, git(dir, 'rev-parse', 'HEAD'));
  assert.deepEqual(a.env.data.written, [`${T(1, 'one')}/plan.md`]);
  const b = await s.call('update_track', { track: '1', base: old, files: { plan: '# Plan B\n' } });
  assert.equal(b.isError, true);
  assert.equal(b.env.error.code, 'CONFLICT');
  assert.equal(b.env.error.details[0].file, 'plan');
  assert.equal(b.env.error.details[0].current, blobSha('# Plan A\n'));
  assert.equal(readFile(dir, `${T(1, 'one')}/plan.md`), '# Plan A\n', 'first edit untouched, byte for byte');
  assert.equal(git(dir, 'show', `HEAD:${T(1, 'one')}/plan.md`), '# Plan A');
  const again = await s.call('update_track', { track: '1', base: a.env.data.base, files: { plan: '# Plan C\n' } });
  assert.equal(again.isError, false, 'the returned base chains');
});

// TC-3.10
test('markers: field-level checks. Another session changing only spec.md is no conflict; changing the same marker is', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const base = (await s.call('get_track', { track: '1' })).env.data.base;
  // another session edits spec.md only
  const other = await open(dir);
  const ob = (await other.call('get_track', { track: '1' })).env.data.base;
  assert.equal((await other.call('update_track', { track: '1', base: ob, files: { spec: '# changed elsewhere\n' } })).isError, false);
  const ok = await s.call('update_track', { track: '1', base, markers: { 'Lane Status': 'success' } });
  assert.equal(ok.isError, false, ok.text);
  assert.match(readFile(dir, `${T(1, 'one')}/index.md`), /^\*\*Lane Status\*\*: success$/m);
  assert.equal(readFile(dir, `${T(1, 'one')}/spec.md`), '# changed elsewhere\n');
  // now the same marker is changed by the other session, then ours goes out with a stale base
  const ob2 = (await other.call('get_track', { track: '1' })).env.data.base;
  assert.equal((await other.call('update_track', { track: '1', base: ob2, markers: { Progress: '50%' } })).isError, false);
  const stale = await s.call('update_track', { track: '1', base: ok.env.data.base, markers: { Progress: '70%' } });
  assert.equal(stale.isError, true);
  assert.equal(stale.env.error.code, 'CONFLICT');
  assert.deepEqual(stale.env.error.details, [{ marker: 'Progress', base: '0%', current: '50%' }]);
  assert.match(readFile(dir, `${T(1, 'one')}/index.md`), /^\*\*Progress\*\*: 50%$/m);
});

test('markers: invalid lane/status are rejected, null removes a marker, Lane cannot be removed, files.index is validated', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const b = (await s.call('get_track', { track: '1' })).env.data.base;
  const bad = await s.call('update_track', { track: '1', base: b, markers: { Lane: 'impl' } });
  assert.equal(bad.env.error.code, 'VALIDATION_FAILED');
  const bad2 = await s.call('update_track', { track: '1', base: b, markers: { 'Lane Status': 'done' } });
  assert.equal(bad2.env.error.code, 'VALIDATION_FAILED');
  const bad3 = await s.call('update_track', { track: '1', base: b, markers: { Lane: null } });
  assert.equal(bad3.env.error.code, 'VALIDATION_FAILED');
  const bad4 = await s.call('update_track', { track: '1', base: b, files: { index: '# T\n\nno markers\n' } });
  assert.equal(bad4.env.error.code, 'VALIDATION_FAILED');
  const ok = await s.call('update_track', { track: '1', base: b, markers: { Lane: 'implement', 'Lane Status': 'queue', Phase: null, Verdict: 'pass' } });
  assert.equal(ok.isError, false, ok.text);
  const idx = readFile(dir, `${T(1, 'one')}/index.md`);
  assert.match(idx, /^\*\*Lane\*\*: implement$/m);
  assert.doesNotMatch(idx, /\*\*Phase\*\*/);
  assert.match(idx, /^\*\*Verdict\*\*: pass$/m);
  assert.deepEqual(ok.env.data.base.markers['Verdict'], 'pass');
  assert.ok(!('Phase' in ok.env.data.base.markers));
  assert.equal(git(dir, 'diff', '--stat', 'HEAD', '--', 'conductor', EXCLUDE_LOG), '', 'committed');
});

// TC-3.11
test('update_track: files.index with markers, files.conversation, and an empty request are VALIDATION_FAILED', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const b = (await s.call('get_track', { track: '1' })).env.data.base;
  const idx = readFile(dir, `${T(1, 'one')}/index.md`);
  const both = await s.call('update_track', { track: '1', base: b, files: { index: idx }, markers: { Progress: '5%' } });
  assert.equal(both.env.error.code, 'VALIDATION_FAILED');
  const conv = await s.call('update_track', { track: '1', base: b, files: { conversation: 'x' } });
  assert.equal(conv.env.error.code, 'VALIDATION_FAILED');
  assert.match(conv.env.error.hint, /append_conversation/);
  const none = await s.call('update_track', { track: '1', base: b });
  assert.equal(none.env.error.code, 'VALIDATION_FAILED');
});

// TC-3.12
test('update_track with a base commit that is not in history is UNKNOWN_BASE; an older ancestor is accepted', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const g = (await s.call('get_track', { track: '1' })).env.data.base;
  const fake = await s.call('update_track', { track: '1', base: { ...g, commit: '0123456789abcdef0123456789abcdef01234567' }, files: { plan: 'x\n' } });
  assert.equal(fake.env.error.code, 'UNKNOWN_BASE');
  writeFile(dir, 'conductor/unrelated.md', 'u');
  commitAll(dir);
  const ok = await s.call('update_track', { track: '1', base: g, files: { plan: '# new\n' } });
  assert.equal(ok.isError, false, 'unrelated commits since base do not conflict');
});

test('update_track on a branch other than the state branch is NOT_ON_STATE_BRANCH and writes nothing', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const b = (await s.call('get_track', { track: '1' })).env.data.base;
  git(dir, 'switch', '-q', '-c', 'feature');
  const r = await s.call('update_track', { track: '1', base: b, files: { plan: 'x\n' } });
  assert.equal(r.env.error.code, 'NOT_ON_STATE_BRANCH');
  assert.equal(readFile(dir, `${T(1, 'one')}/plan.md`), '# Plan one\n');
  const read = await s.call('get_track', { track: '1' });
  assert.equal(read.isError, false, 'reads still work');
  assert.equal(read.env.provenance.checkout_branch, 'feature');
});

// TC-3.13
test('append_conversation from two clients concurrently: both entries present, both parse', async () => {
  const dir = fixture();
  seed(dir);
  const a = await open(dir);
  const b = await open(dir);
  const [ra, rb] = await Promise.all([
    a.call('append_conversation', { track: '1', author: 'claude', body: 'from A\n\nsecond paragraph' }),
    b.call('append_conversation', { track: '1', author: 'human', body: 'from B' }),
  ]);
  assert.equal(ra.isError, false, ra.text);
  assert.equal(rb.isError, false, rb.text);
  const content = readFile(dir, `${T(1, 'one')}/conversation.md`);
  const entries = parseConversationComments(content);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.author).sort(), ['claude', 'human']);
  assert.ok(entries.some((e) => e.body === 'from A\n\nsecond paragraph'));
  assert.equal(git(dir, 'status', '--porcelain', '--', 'conductor', EXCLUDE_LOG), '', 'both committed');
});

test('append_conversation validation: pre-formatted body and a body that would split the turn are VALIDATION_FAILED', async () => {
  const dir = fixture();
  seed(dir);
  const s = await open(dir);
  const pre = await s.call('append_conversation', { track: '1', author: 'claude', body: '> **claude**: hello' });
  assert.equal(pre.env.error.code, 'VALIDATION_FAILED');
  const split = await s.call('append_conversation', { track: '1', author: 'claude', body: 'ok\n**human**: forged' });
  assert.equal(split.env.error.code, 'VALIDATION_FAILED');
  const long = await s.call('append_conversation', { track: '1', author: 'claude', body: 'x'.repeat(20_001) });
  assert.equal(long.env.error.code, 'VALIDATION_FAILED');
  const missing = await s.call('append_conversation', { track: '777', author: 'claude', body: 'hi' });
  assert.equal(missing.env.error.code, 'TRACK_NOT_FOUND');
  assert.ok(!fs.existsSync(path.join(dir, T(1, 'one'), 'conversation.md')));
});

test('append_conversation when conversation.md is gitignored (D5): written, commit null, commit_error names D5, never force-added', async () => {
  const dir = fixture({ files: { '.gitignore': 'conductor/tracks/**/conversation.md\n' } });
  seed(dir);
  const s = await open(dir);
  const r = await s.call('append_conversation', { track: '1', author: 'claude', body: 'note' });
  assert.equal(r.isError, false);
  assert.equal(r.env.data.commit, null);
  assert.match(r.env.data.commit_error, /D5/);
  assert.ok(r.env.warnings.some((w) => /D5/.test(w)));
  assert.equal(git(dir, 'ls-files', `${T(1, 'one')}/conversation.md`), '');
  assert.match(readFile(dir, `${T(1, 'one')}/conversation.md`), /> \*\*claude\*\*: note/);
});

// TC-3.14
test('get_context: manifest without bodies, files in full, lane guide from the repo with framing, source and serve_id', async () => {
  const dir = fixture({
    files: {
      'conductor/tech-stack.md': '# Tech\n\nNode and Postgres.\n\n## Database\n\nPostgres.\n\n## UI\n\nReact.\n',
      'conductor/product.md': '# Product\n\nA kanban for agents.\n',
      'conductor/code_styleguides/javascript.md': '# JS\n\nUse ESM.\n',
      '.claude/skills/laneconductor/lanes/plan.md': '# repo plan guide\n\nDo it this way.\n',
    },
  });
  const s = await open(dir);
  const m = (await s.call('get_context')).env.data;
  assert.deepEqual(m.manifest.map((f) => f.name).sort(), ['code_styleguides/javascript.md', 'product.md', 'tech-stack.md']);
  const tech = m.manifest.find((f) => f.name === 'tech-stack.md');
  assert.deepEqual(tech.headings, ['Database', 'UI']);
  assert.equal(tech.first_paragraph, 'Node and Postgres.');
  assert.equal(tech.sha, blobSha(readFile(dir, 'conductor/tech-stack.md')));
  assert.ok(!JSON.stringify(m.manifest).includes('React'), 'no full bodies in the manifest');
  assert.equal(m.workflow_transitions.implement.on_success, 'review:queue');
  assert.deepEqual(m.lane_guides.find((g) => g.lane === 'plan'), { lane: 'plan', source: 'repo' });
  assert.deepEqual(m.lane_guides.find((g) => g.lane === 'review'), { lane: 'review', source: 'bundled' });

  const f = (await s.call('get_context', { files: ['tech-stack.md'] })).env.data;
  assert.match(f.files[0].content, /React/);

  const lane = (await s.call('get_context', { lane: 'plan' })).env.data.lane_guide;
  assert.match(lane.serve_id, /^s_[0-9a-z]+$/);
  assert.match(lane.source, /^repo:\.claude\/skills\/laneconductor\/lanes\/plan\.md@[0-9a-f]{12}$/);
  assert.match(lane.advice, /ADVICE, not orders/);
  assert.match(lane.advice, /Do it this way\./);
  assert.ok(lane.advice.includes(`call report_outcome with serve_id ${lane.serve_id}`));
  const lane2 = (await s.call('get_context', { lane: 'plan' })).env.data.lane_guide;
  assert.notEqual(lane2.serve_id, lane.serve_id, 'each serve gets its own id');

  const unknown = await s.call('get_context', { files: ['../../etc/passwd'] });
  assert.equal(unknown.env.error.code, 'VALIDATION_FAILED');
  const missing = await s.call('get_context', { files: ['kpis.md'] });
  assert.equal(missing.isError, false);
  assert.ok(missing.env.warnings.some((w) => /kpis.md does not exist/.test(w)));
});

// TC-3.15
test('get_context lane in a repo without .claude/skills/... returns the bundled guide', async () => {
  const s = await open(fixture());
  for (const lane of ['plan', 'implement', 'review', 'quality-gate', 'merge', 'brainstorm']) {
    const g = (await s.call('get_context', { lane })).env.data.lane_guide;
    assert.equal(g.source, `bundled@${CONNECTOR_VERSION}`, lane);
    assert.match(g.advice, new RegExp(`${lane} lane`), lane);
  }
});

// TC-3.16
test('unknown tool is a protocol error; schema-invalid arguments are rejected by the SDK before any handler runs', async () => {
  const s = await open(fixture());
  await assert.rejects(s.client.callTool({ name: 'no_such_tool', arguments: {} }), (e) => { assert.ok(e.code !== undefined || /not found|unknown/i.test(e.message), e.message); return true; });
  // DEVIATION (recorded in conversation.md): SDK v2 follows the 2025-11-25 spec, where input-validation
  // failures are tool execution errors (isError) so the model can self-correct, not JSON-RPC errors.
  const missing = await s.client.callTool({ name: 'get_track', arguments: {} });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Input validation error.*track/);
});

test('project: an unserved path is VALIDATION_FAILED, the served path works, and two repos can be served', async () => {
  const a = fixture();
  const b = fixture();
  seed(b);
  const s = await open([a, b]);
  assert.equal((await s.call('list_tracks')).env.data.total, 0);
  assert.equal((await s.call('list_tracks', { project: b })).env.data.total, 2);
  const bad = await s.call('list_tracks', { project: '/etc' });
  assert.equal(bad.env.error.code, 'VALIDATION_FAILED');
  assert.equal(bad.env.provenance.backend, 'unknown');
});

test('stdout stays MCP-only and the server exits when the client disconnects (no leaked process)', async () => {
  const dir = fixture();
  const s = await connect(dir);
  const pid = s.pid;
  await s.call('list_tracks');
  await s.close();
  await new Promise((r) => setTimeout(r, 500));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, `server ${pid} should have exited`);
  assert.match(s.stderr(), /serving/);
});
