// Track 10050 Phase 4: real git repositories, real commit SHAs.
//
// The unit tests in track-10050-worktree-start-point.test.mjs prove the
// DECISION. They cannot prove the branch a worker actually creates has the
// right base — and that gap is exactly where this track's bug lived: the old
// createWorktree() took resolveWorktreeAddArgs' result and then re-built the
// git command by hand, hardcoding `HEAD` back in. Every unit test stayed
// green while the start point was silently discarded.
//
// So these tests drive the SAME functions laneconductor.sync.mjs:3996-4015
// calls, in the same order, and then assert on `git rev-parse` output from a
// real worktree:
//
//     probeWorktreeStartPoint()  ->  resolveWorktreeAddArgs()
//                                ->  renderWorktreeAddCommand()  ->  execSync
//
// Plus a source-level guard (last test) that sync.mjs has not drifted back to
// hand-rolling that command.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { probeWorktreeStartPoint, writeStaleBaseNotice } from '../services/worktree-start-point.mjs';
import { resolveWorktreeAddArgs, renderWorktreeAddCommand } from '../services/worktree-create-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = 'main';

let TMP;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function commit(repo, name, msg) {
  writeFileSync(join(repo, name), `${msg}\n`, 'utf8');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', msg], repo);
  return git(['rev-parse', 'HEAD'], repo);
}

/**
 * Builds a bare `origin` plus a working clone, both on `main`, sharing one
 * initial commit. `pusher` is a second clone used to push commits to origin
 * behind `local`'s back — that's how "behind"/"diverged" states are made.
 */
function makeRepos(label) {
  const root = mkdtempSync(join(TMP, `${label}-`));
  const origin = join(root, 'origin.git');
  const local = join(root, 'local');
  const pusher = join(root, 'pusher');

  execFileSync('git', ['init', '--bare', '-b', MAIN, origin], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, local], { stdio: 'pipe' });
  for (const repo of [local]) {
    git(['config', 'user.email', 'test@example.com'], repo);
    git(['config', 'user.name', 'Test User'], repo);
    git(['symbolic-ref', 'HEAD', `refs/heads/${MAIN}`], repo);
  }
  commit(local, 'base.txt', 'base commit');
  git(['push', '-q', 'origin', MAIN], local);

  execFileSync('git', ['clone', '-q', origin, pusher], { stdio: 'pipe' });
  git(['config', 'user.email', 'other@example.com'], pusher);
  git(['config', 'user.name', 'Other Dev'], pusher);

  return { root, origin, local, pusher };
}

/** Pushes N commits to origin/main from the second clone. */
function pushRemoteCommits(repos, n) {
  for (let i = 0; i < n; i++) commit(repos.pusher, `remote-${i}.txt`, `remote commit ${i}`);
  git(['push', '-q', 'origin', MAIN], repos.pusher);
}

/**
 * The exact composition laneconductor.sync.mjs performs. Deliberately not a
 * re-implementation of the decision — it calls the real functions.
 */
async function createTrackWorktree(repoRoot, trackNumber, { autoPull = true } = {}) {
  const branchName = `track-${trackNumber}`;
  const worktreePath = join(repoRoot, '.worktrees', String(trackNumber));
  mkdirSync(join(repoRoot, '.worktrees'), { recursive: true });

  let branchExists = false;
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], repoRoot);
    branchExists = true;
  } catch { /* new branch */ }

  const info = branchExists
    ? { startPoint: 'HEAD', reason: 'existing-branch', staleBy: null }
    : await probeWorktreeStartPoint({ repoRoot, mainBranch: MAIN, autoPull });

  const addArgs = resolveWorktreeAddArgs({ branchExists, branchName, worktreePath, startPoint: info.startPoint });
  execSync(renderWorktreeAddCommand(addArgs), { cwd: repoRoot, stdio: 'pipe' });

  return { info, worktreePath, branchName, addArgs };
}

before(() => { TMP = mkdtempSync(join(tmpdir(), 'lc-10050-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

describe('track 10050 — worktree base freshness (real git)', () => {
  it('TC-9: local main behind origin/main → branch is based on the incoming commits', async () => {
    const repos = makeRepos('behind');
    pushRemoteCommits(repos, 2);
    const originSha = git(['rev-parse', `refs/heads/${MAIN}`], repos.origin);

    const { info, worktreePath } = await createTrackWorktree(repos.local, 909);

    assert.equal(info.reason, 'refreshed');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), originSha,
      'the new branch must start at origin/main, not at the stale local main');
    assert.equal(git(['rev-parse', MAIN], repos.local), originSha,
      'local main should have been fast-forwarded too');
  });

  it('TC-10: local main AHEAD of origin/main → branch keeps every local-only commit', async () => {
    const repos = makeRepos('ahead');
    const localOnly = [];
    for (let i = 0; i < 3; i++) localOnly.push(commit(repos.local, `local-${i}.txt`, `local commit ${i}`));
    const localMainSha = git(['rev-parse', MAIN], repos.local);

    const { info, worktreePath } = await createTrackWorktree(repos.local, 910);

    assert.equal(info.reason, 'local-ahead');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), localMainSha);
    // The regression a naive origin/main fix would cause, asserted directly.
    for (const sha of localOnly) {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: worktreePath, stdio: 'pipe' });
    }
    const originSha = git(['rev-parse', `refs/heads/${MAIN}`], repos.origin);
    assert.notEqual(git(['rev-parse', 'HEAD'], worktreePath), originSha,
      'basing on origin/main here would silently drop the 3 local-only commits');
  });

  it('TC-11: primary checkout on an unrelated branch → branch is based on main, not on that branch', async () => {
    const repos = makeRepos('otherbranch');
    const mainSha = git(['rev-parse', MAIN], repos.local);
    git(['checkout', '-q', '-b', 'scratch-wip'], repos.local);
    const wipSha = commit(repos.local, 'wip.txt', 'unrelated work in progress');
    assert.notEqual(git(['rev-parse', 'HEAD'], repos.local), mainSha, 'precondition: HEAD is not main');

    const { info, worktreePath } = await createTrackWorktree(repos.local, 911);

    assert.equal(info.startPoint, MAIN, 'must resolve the main ref by name, never the literal HEAD');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), mainSha);
    assert.throws(
      () => execFileSync('git', ['merge-base', '--is-ancestor', wipSha, 'HEAD'], { cwd: worktreePath, stdio: 'pipe' }),
      'the unrelated branch\'s commit must NOT be in the track branch\'s history');
  });

  it('TC-12: diverged main → based on local main, and the staleness is announced on the track', async () => {
    const repos = makeRepos('diverged');
    pushRemoteCommits(repos, 2);
    for (let i = 0; i < 2; i++) commit(repos.local, `local-${i}.txt`, `local commit ${i}`);
    const localMainSha = git(['rev-parse', MAIN], repos.local);

    const { info, worktreePath } = await createTrackWorktree(repos.local, 912);

    assert.equal(info.reason, 'diverged');
    assert.equal(info.staleBy, 2);
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), localMainSha,
      'never origin/main when diverged — that would drop the 2 local commits');

    // REQ-7: the notice actually lands, in the format the comment parser needs.
    const trackDir = join(repos.local, 'conductor', 'tracks', '912-diverged');
    mkdirSync(trackDir, { recursive: true });
    const convPath = join(trackDir, 'conversation.md');
    writeFileSync(convPath, '# Conversation: Track 912\n', 'utf8');

    assert.equal(writeStaleBaseNotice(convPath, info, MAIN), true);
    const conv = readFileSync(convPath, 'utf8');
    assert.match(conv, /^> \*\*system\*\*: ⚠️ .*2 commit\(s\) behind/m);
    assert.equal(conv.match(/^> \*\*system\*\*: ⚠️/gm).length, 1, 'exactly one notice');
  });

  it('TC-13: existing track branch is checked out as-is — never reset onto a fresher base (track 1114)', async () => {
    const repos = makeRepos('resume');
    // A branch with real work on it, and no worktree — the resumed-track shape.
    git(['branch', 'track-913', MAIN], repos.local);
    git(['checkout', '-q', 'track-913'], repos.local);
    const branchSha = commit(repos.local, 'work.txt', 'real committed work on the track branch');
    git(['checkout', '-q', MAIN], repos.local);
    // Move main on, so a reset-to-base would be plainly visible.
    commit(repos.local, 'moved-on.txt', 'main moved on');

    const { worktreePath, addArgs } = await createTrackWorktree(repos.local, 913);

    assert.equal(git(['rev-parse', 'track-913'], repos.local), branchSha,
      'the existing branch tip must be byte-identical — this was real data loss in 1114');
    assert.ok(!addArgs.includes('-B'), 'must never force-create over an existing branch');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), branchSha);
    assert.equal(git(['symbolic-ref', '--short', 'HEAD'], worktreePath), 'track-913');
  });

  it('TC-14 (REQ-8): unreachable origin still creates the worktree, and stays silent', async () => {
    const repos = makeRepos('offline');
    git(['remote', 'set-url', 'origin', join(repos.root, 'does-not-exist.git')], repos.local);
    const localMainSha = git(['rev-parse', MAIN], repos.local);

    const { info, worktreePath } = await createTrackWorktree(repos.local, 914);

    assert.equal(info.reason, 'offline');
    assert.equal(info.staleBy, null, 'unknown, not zero');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), localMainSha);
    assert.equal(writeStaleBaseNotice('/tmp/nonexistent-conv.md', info, MAIN), false,
      'offline must never post a staleness warning it cannot substantiate');
  });

  it('TC-15: repo with no local main ref falls back to HEAD, exactly as before', async () => {
    const root = mkdtempSync(join(TMP, 'nomain-'));
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'trunk', repo], { stdio: 'pipe' });
    git(['config', 'user.email', 'test@example.com'], repo);
    git(['config', 'user.name', 'Test User'], repo);
    const sha = commit(repo, 'only.txt', 'the one and only commit');

    const info = await probeWorktreeStartPoint({ repoRoot: repo, mainBranch: MAIN });
    assert.equal(info.reason, 'no-main-ref');
    assert.equal(info.startPoint, 'HEAD');

    const { worktreePath } = await createTrackWorktree(repo, 915);
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), sha);
  });

  it('honours git.auto_pull: false — reports the remote ref rather than moving local main', async () => {
    const repos = makeRepos('nopull');
    pushRemoteCommits(repos, 2);
    const localMainBefore = git(['rev-parse', MAIN], repos.local);
    const originSha = git(['rev-parse', `refs/heads/${MAIN}`], repos.origin);

    const { info, worktreePath } = await createTrackWorktree(repos.local, 916, { autoPull: false });

    assert.equal(info.reason, 'remote-ahead-pull-refused');
    assert.equal(info.startPoint, `origin/${MAIN}`);
    assert.equal(git(['rev-parse', MAIN], repos.local), localMainBefore,
      'auto_pull: false means local main must not be moved');
    assert.equal(git(['rev-parse', 'HEAD'], worktreePath), originSha,
      'but the branch still starts from the freshest available base');
  });

  it('source guard: laneconductor.sync.mjs does not hand-roll the worktree add command', () => {
    const src = readFileSync(join(__dirname, '..', 'laneconductor.sync.mjs'), 'utf8');
    assert.ok(!/git worktree add -B "\$\{branchName\}"/.test(src),
      'the hand-rolled command string is back — it discards the resolved start point (see renderWorktreeAddCommand)');
    assert.ok(src.includes('renderWorktreeAddCommand(addArgs)'),
      'createWorktree must render from the resolved args, not a duplicate string');
    assert.ok(!/startPoint: 'HEAD' \}\);/.test(src.replace(/\n/g, ' ')) || src.includes('probeWorktreeStartPoint'),
      'createWorktree must resolve its start point, not hardcode HEAD');
  });
});
