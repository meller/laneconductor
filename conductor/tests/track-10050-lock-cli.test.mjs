// Track 10050 Phase 3 (REQ-9): conductor/lock.mjs — the `/laneconductor lock`
// entry point — created its worktree with:
//
//     git worktree add "<path>" origin/main
//
// Three defects in one line. Hardcoded `origin/main` (TC-17: simply broken on
// a `master` repo). Unconditionally the remote ref (so local-only commits are
// dropped — see services/worktree-start-point.mjs). And no `-b`, so the
// worktree came out DETACHED: anything committed during a lock session landed
// on no branch and was unreachable afterwards (TC-16).
//
// These run the real CLI as a subprocess against real scratch repos, because
// the whole point is the behaviour of the shipped entry point, not of a
// function it happens to call.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_CLI = join(__dirname, '..', 'lock.mjs');
const UNLOCK_CLI = join(__dirname, '..', 'unlock.mjs');

let TMP;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runCli(script, trackNumber, cwd) {
  return execFileSync(process.execPath, [script, String(trackNumber)],
    { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Bare origin + working clone, on `branch`, sharing one commit. */
function makeRepo(label, branch) {
  const root = mkdtempSync(join(TMP, `${label}-`));
  const origin = join(root, 'origin.git');
  const local = join(root, 'local');

  execFileSync('git', ['init', '--bare', '-b', branch, origin], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, local], { stdio: 'pipe' });
  git(['config', 'user.email', 'test@example.com'], local);
  git(['config', 'user.name', 'Test User'], local);
  git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], local);
  writeFileSync(join(local, 'base.txt'), 'base\n', 'utf8');
  git(['add', '-A'], local);
  git(['commit', '-q', '-m', 'base commit'], local);
  git(['push', '-q', 'origin', branch], local);
  return { root, origin, local };
}

before(() => { TMP = mkdtempSync(join(tmpdir(), 'lc-10050-lock-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

describe('track 10050 — /laneconductor lock worktree creation', () => {
  it('TC-16: creates the worktree on track-N, not detached', () => {
    const { local } = makeRepo('lock-main', 'main');

    const out = runCli(LOCK_CLI, 501, local);
    const result = JSON.parse(out.slice(out.indexOf('{')));
    assert.equal(result.locked, true);
    assert.ok(existsSync(result.worktree_path), 'worktree directory should exist');

    // The heart of it: `symbolic-ref HEAD` throws on a detached HEAD, which is
    // exactly what the old `git worktree add <path> origin/main` produced.
    const head = git(['symbolic-ref', '--short', 'HEAD'], result.worktree_path);
    assert.equal(head, 'track-501');

    // And a commit made in that session is reachable from the branch.
    writeFileSync(join(result.worktree_path, 'work.txt'), 'session work\n', 'utf8');
    git(['add', '-A'], result.worktree_path);
    git(['commit', '-q', '-m', 'work done during the lock session'], result.worktree_path);
    assert.equal(git(['rev-parse', 'track-501'], local), git(['rev-parse', 'HEAD'], result.worktree_path));
  });

  it('TC-17: works on a repo whose default branch is master', () => {
    const { local } = makeRepo('lock-master', 'master');
    const masterSha = git(['rev-parse', 'master'], local);

    const out = runCli(LOCK_CLI, 502, local);
    const result = JSON.parse(out.slice(out.indexOf('{')));

    assert.equal(git(['symbolic-ref', '--short', 'HEAD'], result.worktree_path), 'track-502');
    // Ancestry, not SHA equality: lock.mjs commits the lock file to the
    // default branch before creating the worktree, so the tip has moved on by
    // one commit by the time we get here. What matters is that the branch
    // descends from master at all — the old hardcoded `origin/main` does not
    // even resolve in this repo, so it could not have.
    execFileSync('git', ['merge-base', '--is-ancestor', masterSha, 'HEAD'],
      { cwd: result.worktree_path, stdio: 'pipe' });
    assert.ok(git(['log', '--oneline', 'HEAD'], result.worktree_path).includes('base commit'));
  });

  it('TC-17b: keeps local-only commits — never bases blindly on the remote ref', () => {
    const { local } = makeRepo('lock-ahead', 'main');
    writeFileSync(join(local, 'local-only.txt'), 'not pushed\n', 'utf8');
    git(['add', '-A'], local);
    git(['commit', '-q', '-m', 'local-only commit'], local);
    const localOnlySha = git(['rev-parse', 'HEAD'], local);

    const out = runCli(LOCK_CLI, 503, local);
    const result = JSON.parse(out.slice(out.indexOf('{')));

    // lock.mjs also commits the lock file itself, so assert ancestry rather
    // than SHA equality.
    execFileSync('git', ['merge-base', '--is-ancestor', localOnlySha, 'HEAD'],
      { cwd: result.worktree_path, stdio: 'pipe' });
  });

  it('TC-18: unlock removes the worktree and the lock file', () => {
    const { local } = makeRepo('unlock', 'main');
    const lockOut = runCli(LOCK_CLI, 504, local);
    const locked = JSON.parse(lockOut.slice(lockOut.indexOf('{')));
    assert.ok(existsSync(locked.worktree_path));
    assert.ok(existsSync(locked.lock_file));

    runCli(UNLOCK_CLI, 504, local);

    assert.ok(!existsSync(locked.lock_file), 'lock file should be gone');
    assert.ok(!existsSync(locked.worktree_path), 'worktree should be removed');
    const list = git(['worktree', 'list', '--porcelain'], local);
    assert.ok(!list.includes('.worktrees/504'), `worktree still listed:\n${list}`);
  });
});
