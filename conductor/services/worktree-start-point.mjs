// conductor/services/worktree-start-point.mjs
//
// Track 10050 (found live): createWorktree() based every new track branch on
// the literal string `HEAD` — `git worktree add -B track-N <path> HEAD`
// (laneconductor.sync.mjs:3940/3943). That produced two separate defects:
//
//   1. STALE BASE. Local <main> is only ever refreshed from origin/<main> by
//      checkOutOfBandGitSync(), which acts at most every
//      git.fetch_interval_ms (default 5 minutes) and only for a strict
//      fast-forward — safePull() refuses outright when ahead > 0. So a track
//      branch could start well behind origin/<main>, the agent implemented
//      against a base main had moved past, and the bill arrived at merge time
//      as conflicts. Nothing surfaced the staleness before then.
//   2. WRONG REF. `HEAD` resolves against the primary checkout's CURRENT
//      branch, and nothing anywhere asserts that is <main>. A human (or a
//      prior workspace:main run) leaving the checkout on another branch
//      silently contaminated every track branch created afterwards.
//
// ── Why this does NOT just use origin/<main> ────────────────────────────────
// That is the intuitive fix, and two other call sites in this repo already do
// it (conductor/lock.mjs:138, and the dead conductor/agent-runtime.mjs:115).
// It would make this repository strictly WORSE. Measured on it directly:
//
//     $ git rev-list --left-right --count main...origin/main
//     27      0
//
// 27 local-only commits, 0 incoming — and that is the steady state, not an
// anomaly. The worker COMMITS to local <main> on every lane action
// ("chore(track-N): sync files before worktree", laneconductor.sync.mjs:3857,
// plus git lock commits) and mergeWorktreeBranch() advances refs/heads/<main>
// via update-ref, but NOTHING ever pushes. Basing new track branches on
// origin/<main> there would start every track 27 commits in the past, missing
// every already-merged track, manufacturing precisely the merge conflicts
// this track exists to eliminate.
//
// So the requirement is "the freshest base that loses nothing", NOT
// "origin/<main>". The two coincide only when local <main> has no unique
// commits. Please do not "simplify" this back.
//
// ── Layout ──────────────────────────────────────────────────────────────────
// Extracted here for testability, same reason as services/worktree-create-args.mjs
// (track 1114): laneconductor.sync.mjs has no exports and runs setIntervals
// and chokidar watchers at import, so nothing in it can be unit-tested.
//
//   resolveWorktreeStartPoint()  — the decision. Pure: no I/O of any kind.
//   probeWorktreeStartPoint()    — the git I/O that feeds it.
//   formatStaleBaseNotice()      — pure; the REQ-7 warning text.
//   writeStaleBaseNotice()       — appends that to a track's conversation.md.
//
// The module as a whole does touch child_process and fs (the latter two
// functions); the decision itself deliberately does not, so every row of the
// resolution table is testable without a repository.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { checkDivergence, safePull } from './git-divergence.mjs';

/**
 * @param {object} input
 * @param {string} input.mainBranch      e.g. 'main' — from getMainBranch()
 * @param {boolean} input.mainRefExists  does refs/heads/<mainBranch> resolve locally?
 * @param {boolean} input.fetchOk        did checkDivergence()'s fetch succeed?
 * @param {number|null} input.ahead      commits on local <main> that origin/<main> lacks
 * @param {number|null} input.behind     commits on origin/<main> that local <main> lacks
 * @param {string|null} input.pullOutcome  'pulled' | safePull()'s `reason` | null (not attempted)
 * @returns {{ startPoint: string, reason: string, staleBy: number|null }}
 *   `staleBy` is the number of origin/<main> commits the resolved base is
 *   missing: 0 when provably fresh, a positive count when knowingly stale, and
 *   **null when unknowable** (offline, no ref). Null and 0 are deliberately
 *   distinct — REQ-7 comments only on a positive count, and must not treat
 *   "couldn't tell" as "fine".
 */
export function resolveWorktreeStartPoint({
  mainBranch,
  mainRefExists,
  fetchOk,
  ahead,
  behind,
  pullOutcome,
}) {
  // Checked first: every row below returns a named ref that presumes
  // <mainBranch> resolves. A repo with a single commit and no <main> ref is
  // real — see laneconductor.sync.mjs:7086's brand-new-project bootstrap —
  // and must keep working exactly as it does today.
  if (!mainRefExists) {
    return { startPoint: 'HEAD', reason: 'no-main-ref', staleBy: null };
  }

  // No usable divergence data. Fall back to the local <main> ref: still an
  // improvement over `HEAD` (fixes defect 2), but we cannot claim freshness.
  if (!fetchOk || ahead === null || behind === null || ahead === undefined || behind === undefined) {
    return { startPoint: mainBranch, reason: 'offline', staleBy: null };
  }

  if (behind > 0 && ahead === 0) {
    // Strictly behind with nothing local to lose. If the caller managed to
    // fast-forward local <main>, it now IS origin/<main> — prefer the local
    // ref so the worktree and the primary checkout agree.
    if (pullOutcome === 'pulled') {
      return { startPoint: mainBranch, reason: 'refreshed', staleBy: 0 };
    }
    // The pull was refused (dirty overlap, auto_pull disabled, a merge that
    // failed at the last moment, or never attempted). Since ahead === 0,
    // origin/<main> is a strict superset of local <main> — using it directly
    // loses nothing and is the freshest available base.
    return { startPoint: 'origin/' + mainBranch, reason: 'remote-ahead-pull-refused', staleBy: 0 };
  }

  if (ahead > 0 && behind > 0) {
    // Diverged. origin/<main> would drop `ahead` local commits; local <main>
    // is missing `behind` remote ones. Neither side may be silently discarded,
    // and a real three-way merge of <main> is a human decision, not something
    // to do as a side effect of creating a worktree. Take local <main> — the
    // side that holds work nobody else has — and report the gap so it is
    // visible now rather than at merge time.
    return { startPoint: mainBranch, reason: 'diverged', staleBy: behind };
  }

  if (ahead > 0) {
    // This repo's normal state. Local <main> is the freshest thing there is.
    return { startPoint: mainBranch, reason: 'local-ahead', staleBy: 0 };
  }

  return { startPoint: mainBranch, reason: 'in-sync', staleBy: 0 };
}

/**
 * The I/O half: gathers the facts resolveWorktreeStartPoint() needs from a
 * real repository, optionally fast-forwarding local <mainBranch> first, and
 * returns its verdict.
 *
 * Lives here rather than inline in laneconductor.sync.mjs so the real code
 * path is directly exercisable by a test against real git repos — that file
 * has no exports and runs setIntervals/chokidar at import. A test that had to
 * re-implement this composition instead would be blind to precisely the class
 * of bug this track fixes (see renderWorktreeAddCommand's header).
 *
 * REQ-10: adds no network round-trip in worker use — checkAndClaimGitLock()
 * fetches origin/<main> moments earlier, so checkDivergence()'s own fetch
 * hits an already-current remote.
 *
 * REQ-8: never throws. Every failure degrades to the local <mainBranch> ref,
 * or 'HEAD' when that ref was not positively confirmed to exist — handing
 * `git worktree add` an unresolvable ref would turn a degraded probe into a
 * hard failure to create the worktree, and getMainBranch() guesses when it
 * cannot tell.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot    primary checkout
 * @param {string} opts.mainBranch  from getMainBranch()
 * @param {boolean} [opts.autoPull] honour git.auto_pull (default true)
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ startPoint: string, reason: string, staleBy: number|null }>}
 */
export async function probeWorktreeStartPoint({ repoRoot, mainBranch, autoPull = true, log = () => {} }) {
  let mainRefExists = false;
  try {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${mainBranch}`],
        { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });
      mainRefExists = true;
    } catch { /* non-zero exit — no local <mainBranch> ref; the resolver handles it */ }

    const divergence = await checkDivergence({ repoRoot, mainBranch });

    // Only attempted when it is provably a fast-forward with zero local-only
    // commits. canFastForward is false whenever ahead > 0, and safePull()
    // re-checks that itself plus the dirty-overlap guard, so this can never
    // rewrite or discard local work.
    let pullOutcome = null;
    if (mainRefExists && divergence.canFastForward) {
      const pull = await safePull({ repoRoot, mainBranch, autoPull });
      pullOutcome = pull.pulled ? 'pulled' : pull.reason;
      if (pull.pulled) {
        log(`Fast-forwarded ${mainBranch} ${pull.beforeSha.slice(0, 7)} → ${pull.afterSha.slice(0, 7)} before branching`);
      }
    }

    return resolveWorktreeStartPoint({
      mainBranch,
      mainRefExists,
      fetchOk: divergence.fetchOk,
      ahead: divergence.ahead,
      behind: divergence.behind,
      pullOutcome,
    });
  } catch (err) {
    const fallback = mainRefExists ? mainBranch : 'HEAD';
    log(`Start-point probe failed (${err.message}) — basing on ${fallback}`);
    return { startPoint: fallback, reason: 'probe-failed', staleBy: null };
  }
}

/**
 * Track 10050 (REQ-7): a knowingly-stale base used to be entirely invisible —
 * the track discovered it at merge time, as conflicts. Announce it on the
 * track instead.
 *
 * Fires ONLY for a positive `staleBy`. `local-ahead` is this project's normal
 * steady state and `offline`/`probe-failed` genuinely don't know how stale
 * they are; both stay silent rather than crying wolf on every single worktree
 * creation. This is why the resolver distinguishes staleBy 0 from null.
 *
 * @returns {string|null} the appended comment body, or null if nothing was written.
 */
export function formatStaleBaseNotice(info, mainBranch) {
  if (!info || typeof info.staleBy !== 'number' || info.staleBy <= 0) return null;
  return `⚠️ Track branch based on a stale ${mainBranch} — local ${mainBranch} has diverged from ` +
    `origin/${mainBranch} (${info.staleBy} commit(s) behind). Those commit(s) are not in this ` +
    `branch's base and will need resolving at merge time.`;
}

/**
 * Appends formatStaleBaseNotice()'s result to a track's conversation.md, in
 * the `> **system**: ` format the sync worker's comment parser requires
 * (anything else is silently never synced — see the skill's conversation
 * protocol).
 *
 * The caller must pass the PRIMARY checkout's conversation.md: that file is
 * deliberately excluded from worktree->primary doc sync (see
 * worktree-artifact-merge.mjs's ARTIFACTS note) and only the primary's copy is
 * watched into the DB, so a worktree-side write would never reach anyone.
 *
 * @returns {boolean} whether a comment was written.
 */
export function writeStaleBaseNotice(convPath, info, mainBranch) {
  const body = formatStaleBaseNotice(info, mainBranch);
  if (!body || !convPath || !existsSync(convPath)) return false;
  appendFileSync(convPath, `\n> **system**: ${body}\n`, 'utf8');
  return true;
}
