// conductor/services/pr-flow.mjs
// Track 10018 Phases 2-3: the GitHub PR side of merge_mode: 'pr' — pushing a
// track's branch, opening the PR, and polling it for merge/checks status.
//
// All `gh`/`git` invocations go through an injectable `exec` function
// (defaults to execFileSync) so tests never shell out to a real `gh` CLI or
// touch a real GitHub remote — see conductor/tests/track-10018-pr-flow.test.mjs,
// which injects a fake exec and asserts on the exact argv it was called with.

import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

/**
 * Checks `gh auth status` succeeds. Never throws — a missing/unauthenticated
 * `gh` is a precondition failure the caller must surface loudly (per spec:
 * PR mode must NOT silently fall back to direct merge), not a crash.
 */
export function checkGhAuth({ cwd, exec = defaultExec } = {}) {
  try {
    exec('gh', ['auth', 'status'], { cwd });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString?.() || err.message };
  }
}

/**
 * Pushes `track-<trackNumber>` to origin and opens a PR via `gh pr create`.
 * Returns { number, url } on success, or throws with a descriptive message
 * on failure (caller is responsible for turning that into a track comment —
 * this module has no knowledge of tracks/conversation.md).
 */
export function createTrackPr({ repoRoot, trackNumber, mainBranch = 'main', title, body, exec = defaultExec }) {
  const branch = `track-${trackNumber}`;

  exec('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });

  let output;
  try {
    output = exec('gh', [
      'pr', 'create',
      '--base', mainBranch,
      '--head', branch,
      '--title', title,
      '--body', body,
    ], { cwd: repoRoot });
  } catch (err) {
    // `gh pr create` fails, rather than succeeding idempotently, when a PR
    // for this branch already exists — e.g. a prior quality-gate pass
    // already opened one and this run is a retry (found live on track
    // 1119: every retry threw here, which left the track stuck at
    // quality-gate forever since the caller treats any throw as a hard
    // failure). `gh`'s own error message still names the existing PR's
    // URL, so recover from this one specific case instead of failing.
    const stderr = err.stderr?.toString?.() || err.message || '';
    const existingMatch = stderr.match(/already exists:\s*\n?\s*(\S*\/pull\/(\d+))/);
    if (existingMatch) {
      return { number: parseInt(existingMatch[2], 10), url: existingMatch[1] };
    }
    throw err;
  }

  // `gh pr create` prints the created PR's URL as the last non-empty line
  // of stdout on success (e.g. "https://github.com/org/repo/pull/42").
  const lines = String(output).trim().split('\n').filter(Boolean);
  const url = lines[lines.length - 1];
  const match = url && url.match(/\/pull\/(\d+)\s*$/);
  if (!match) {
    throw new Error(`gh pr create succeeded but its output didn't contain a PR URL: ${JSON.stringify(output)}`);
  }
  return { number: parseInt(match[1], 10), url };
}

/**
 * Polls a PR's current state via `gh pr view --json`. Returns
 * { state, mergeStateStatus, checksStatus } where checksStatus is one of
 * 'pending' | 'passing' | 'failing' | 'none' (derived from statusCheckRollup).
 * Returns null (never throws) on a transient `gh` failure — the reconcile
 * loop must tolerate that without changing any stored state (Phase 3, TC-3.5).
 */
export function pollTrackPr({ repoRoot, prNumber, exec = defaultExec }) {
  let raw;
  try {
    raw = exec('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'state,mergeStateStatus,statusCheckRollup',
    ], { cwd: repoRoot });
  } catch (err) {
    console.warn(`[pr-flow] gh pr view ${prNumber} failed (transient?): ${err.message}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[pr-flow] gh pr view ${prNumber} returned unparseable JSON: ${err.message}`);
    return null;
  }

  const rollup = Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : [];
  let checksStatus = 'none';
  if (rollup.length > 0) {
    const anyFailing = rollup.some(c => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(c.conclusion));
    const anyPending = rollup.some(c => !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED');
    checksStatus = anyFailing ? 'failing' : anyPending ? 'pending' : 'passing';
  }

  return {
    state: parsed.state, // 'OPEN' | 'MERGED' | 'CLOSED'
    mergeStateStatus: parsed.mergeStateStatus, // e.g. 'CLEAN' | 'DIRTY' | 'UNSTABLE' | ...
    checksStatus,
  };
}

/**
 * Maps a pollTrackPr() result to this track's `pr_status` value (see
 * services/merge-mode.mjs's sibling column). Kept as its own pure function
 * so the state-mapping logic (Phase 3 REQ-4) has a single, unit-testable
 * home independent of the reconcile loop's I/O.
 */
export function resolvePrStatus(poll) {
  if (!poll) return null; // transient failure — caller must leave existing status alone
  if (poll.state === 'MERGED') return 'merged';
  if (poll.state === 'CLOSED') return 'closed';
  if (poll.mergeStateStatus === 'DIRTY') return 'conflicted';
  if (poll.checksStatus === 'failing') return 'checks-failed';
  return 'open';
}

/**
 * Merges a PR through GitHub (never locally) so branch protection and
 * required checks are enforced by GitHub itself — the human-approval action
 * from the Worktrees panel's "Merge PR" button (Phase 4).
 */
export function mergeTrackPr({ repoRoot, prNumber, exec = defaultExec }) {
  exec('gh', ['pr', 'merge', String(prNumber), '--merge'], { cwd: repoRoot });
}
