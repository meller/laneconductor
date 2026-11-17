// Phase 5c Task 8: per-repo state branch resolution. Each fixture is a throwaway repo under
// os.tmpdir() with its own `git init`; no network (origin/HEAD is made with update-ref + symbolic-ref).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect, BIN } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, commitAll, rm } from './helpers/repo.mjs';
import { resolveStateBranch, isSafeBranchName } from '../src/state-branch.mjs';

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
const open = async (repos, extraArgs = []) => {
  const s = await connect(repos, { extraArgs });
  sessions.push(s);
  return s;
};
const setConfig = (dir, cfg) => {
  writeFile(dir, '.laneconductor.json', JSON.stringify(cfg));
  commitAll(dir, 'fixture: config');
};
/** origin/HEAD without a network: a remote-tracking ref plus the symbolic HEAD. */
const setOriginHead = (dir, branch) => {
  git(dir, 'update-ref', `refs/remotes/origin/${branch}`, git(dir, 'rev-parse', 'HEAD'));
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
};

test('rule 1: --state-branch wins over config and origin/HEAD, and applies to every --repo', async () => {
  const a = fixture({ branch: 'trunk' });
  const b = fixture({ branch: 'trunk' });
  setConfig(a, { connector: { state_branch: 'from-config' } });
  setOriginHead(b, 'other');
  assert.deepEqual(resolveStateBranch(a, { cliBranch: 'trunk' }), { branch: 'trunk', source: 'cli_flag' });
  const s = await open([a, b], ['--state-branch', 'trunk']);
  for (const project of [a, b]) {
    const r = await s.call('list_tracks', { project });
    assert.equal(r.env.provenance.branch, 'trunk');
    assert.equal(r.env.provenance.state_branch_source, 'cli_flag');
  }
  assert.match(s.stderr(), /state branch trunk \(chosen by cli_flag\)/);
});

test('rule 2: connector.state_branch in .laneconductor.json wins over origin/HEAD and the current branch', async () => {
  const dir = fixture({ branch: 'main' });
  setConfig(dir, { connector: { state_branch: 'conductor-state' } });
  setOriginHead(dir, 'main');
  assert.deepEqual(resolveStateBranch(dir), { branch: 'conductor-state', source: 'config' });
  const s = await open(dir);
  const r = await s.call('list_tracks');
  assert.equal(r.env.provenance.branch, 'conductor-state');
  assert.equal(r.env.provenance.state_branch_source, 'config');
  assert.equal(r.env.provenance.checkout_branch, 'main', 'reads still work off the state branch and say so');
  assert.match(s.stderr(), /state branch conductor-state \(chosen by config\)/);
});

test('rule 3: the default branch from refs/remotes/origin/HEAD, with no fetch', async () => {
  const dir = fixture({ branch: 'master' });
  setOriginHead(dir, 'master');
  git(dir, 'switch', '-q', '-c', 'feature');
  assert.deepEqual(resolveStateBranch(dir), { branch: 'master', source: 'origin_head' });
  const s = await open(dir);
  const r = await s.call('list_tracks');
  assert.equal(r.env.provenance.branch, 'master');
  assert.equal(r.env.provenance.state_branch_source, 'origin_head');
  assert.match(s.stderr(), /state branch master \(chosen by origin_head\)/);
});

test('rule 4: with no config and no origin/HEAD, the current branch is used when it is main or master', async () => {
  const dir = fixture({ branch: 'master' });
  assert.deepEqual(resolveStateBranch(dir), { branch: 'master', source: 'current_branch' });
  const s = await open(dir);
  const r = await s.call('list_tracks');
  assert.equal(r.env.provenance.branch, 'master');
  assert.equal(r.env.provenance.state_branch_source, 'current_branch');
  assert.match(s.stderr(), /state branch master \(chosen by current_branch\)/);
});

test('rule 5: otherwise main, and writes are refused while the checkout is elsewhere (guard unchanged)', async () => {
  const dir = fixture({ branch: 'develop' });
  assert.deepEqual(resolveStateBranch(dir), { branch: 'main', source: 'default' });
  const s = await open(dir);
  const r = await s.call('list_tracks');
  assert.equal(r.env.provenance.branch, 'main');
  assert.equal(r.env.provenance.state_branch_source, 'default');
  assert.equal(r.env.provenance.checkout_branch, 'develop');
  const w = await s.call('create_track', { title: 'Nope', problem: 'p' });
  assert.equal(w.env.error.code, 'NOT_ON_STATE_BRANCH');
  assert.match(s.stderr(), /state branch main \(chosen by default\)/);
});

test('a master-branch repo with no config creates and updates a track through the real stdio server', async () => {
  const dir = fixture({ branch: 'master' });
  const s = await open(dir);
  const c = await s.call('create_track', { title: 'Master track', problem: 'Works on master.' });
  assert.equal(c.isError, false, c.text);
  assert.equal(c.env.provenance.state_branch_source, 'current_branch');
  const d = c.env.data;
  const u = await s.call('update_track', { track: d.track.number, base: d.base, files: { plan: '# Plan\n- [ ] a\n' } });
  assert.equal(u.isError, false, u.text);
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'master');
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '3', 'fixture commit + create + update, all on master');
});

test('an invalid connector.state_branch is a clear startup error naming the repo, not a crash', async () => {
  for (const bad of ['', '  ', 42, '-x', 'a..b', 'a b', 'x.lock', '/abs']) {
    const dir = fixture();
    writeFile(dir, '.laneconductor.json', JSON.stringify({ connector: { state_branch: bad } }));
    const r = await new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, '--repo', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => resolve({ code, err }));
      setTimeout(() => child.kill('SIGKILL'), 8000).unref();
    });
    assert.equal(r.code, 2, `${JSON.stringify(bad)}: ${r.err}`);
    assert.ok(r.err.includes(dir) && r.err.includes('connector.state_branch'), r.err);
    assert.doesNotMatch(r.err, /at .*\.mjs:\d+/, 'no stack trace');
  }
  assert.equal(isSafeBranchName('release/2026.1'), true);
  assert.equal(isSafeBranchName('master'), true);
});

test('multi-repo: each --repo resolves its own state branch independently', async () => {
  const a = fixture({ branch: 'master' }); // rule 4
  const b = fixture({ branch: 'main' }); // rule 2
  setConfig(b, { connector: { state_branch: 'state' } });
  const c = fixture({ branch: 'develop' }); // rule 5
  const s = await open([a, b, c]);
  const got = {};
  for (const [k, project] of Object.entries({ a, b, c })) {
    const r = await s.call('list_tracks', { project });
    got[k] = [r.env.provenance.branch, r.env.provenance.state_branch_source];
  }
  assert.deepEqual(got, { a: ['master', 'current_branch'], b: ['state', 'config'], c: ['main', 'default'] });
  const log = s.stderr();
  assert.ok(log.includes(`${a}: state branch master (chosen by current_branch)`), log);
  assert.ok(log.includes(`${b}: state branch state (chosen by config)`), log);
  assert.ok(log.includes(`${c}: state branch main (chosen by default)`), log);
});
