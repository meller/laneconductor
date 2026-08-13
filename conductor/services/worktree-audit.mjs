// conductor/services/worktree-audit.mjs
// Track 1112 Phase 2: joins git worktree/branch state to each track's own
// lane state, classifying every unmerged track-* branch. This is the core
// logic behind `lc worktrees` — pure, read-only, no mutation of git state,
// no DB, works in every mode including local-fs.
//
// Deliberately reads track content via `git show <branch>:<path>` rather
// than the filesystem, for both worktree-present AND stranded (no
// directory) branches alike — one code path instead of two, and it's the
// only way to read a stranded branch's own state at all (there's no
// directory left to read from disk).

import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    // execFileSync throws on nonzero exit; callers that need the exit code
    // (the conflict check) catch this themselves — everywhere else, a
    // nonzero exit means "this query doesn't apply" (e.g. rev-list on a
    // ref that turns out not to exist), which callers treat as absence.
    return err.stdout ?? '';
  }
}

function parsePorcelainWorktreeList(raw) {
  // `git worktree list --porcelain` — blank-line-separated blocks, each a
  // sequence of "key value" lines (worktree/HEAD/branch/detached/etc). Git
  // always lists the main (primary) working tree first, regardless of which
  // worktree's directory the command was run from — that ordering is the
  // only reliable way to identify the primary checkout, since `repoRoot`
  // passed in by a caller running from a *linked* worktree is not it.
  const byPath = new Map();
  let primaryPath = null;
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    const lines = block.split('\n').filter(Boolean);
    const entry = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(' ');
      entry[key] = rest.join(' ');
    }
    if (entry.worktree) {
      byPath.set(entry.worktree, entry);
      if (primaryPath === null) primaryPath = entry.worktree;
    }
  }
  return { byPath, primaryPath };
}

function listTrackBranches(repoRoot) {
  const raw = git(['branch', '--list', 'track-*', '--format=%(refname:short)'], repoRoot);
  return raw.split('\n').map(l => l.trim()).filter(Boolean);
}

function isAncestor(repoRoot, ref, of) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, of], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function countCommits(repoRoot, range) {
  const out = git(['rev-list', '--count', range], repoRoot);
  const n = parseInt(out.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

// Reads a track's own **Lane**/**Lane Status**/title from a branch's tip
// commit via `git show`, without needing a working directory — works
// identically whether or not a worktree currently exists for it.
function readTrackStateFromBranch(repoRoot, branch, trackNumber) {
  const listing = git(['ls-tree', '--name-only', branch, 'conductor/tracks/'], repoRoot);
  const dirName = listing.split('\n').map(l => l.trim().replace(/\/$/, '')).find(l => {
    const base = l.split('/').pop();
    return base && base.startsWith(`${trackNumber}-`);
  });
  if (!dirName) return null;
  const indexContent = git(['show', `${branch}:${dirName}/index.md`], repoRoot);
  if (!indexContent) return null;
  const lane = indexContent.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const laneStatus = indexContent.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const title = indexContent.match(/^#\s*Track\s+\S+:\s*(.+)$/mi)?.[1]?.trim() ?? null;
  return { lane, laneStatus, title, trackDir: dirName };
}

// Track 1112 Phase 2, corrected twice during implementation:
//
// 1st correction: a branch's OWN tip commit saying done:success is NOT
// sufficient to call it mergeable. If `main` has independently continued
// that same track since the two diverged, the track was re-opened a
// different way (exactly what happened to track 1084 in this repo's real
// history — its old worktree branch still says done:success from an
// early run, but main went on to re-plan and continue it separately;
// blindly merging the stale branch back would fight main's own newer
// progress on the same track).
//
// 2nd correction: the first version of this check ("did main touch ANY
// file in the track's directory since the merge-base") was too broad — it
// also caught genuine, real conflicts unrelated to re-opening (a routine
// sync-worker Progress-percent update, or two branches touching different
// lines of the same file) and misclassified them as merely "open" instead
// of surfacing them as a conflict to look at. Narrowed to the actual
// semantic signal: did the track's **Lane**/**Lane Status** MARKERS
// specifically change on main since the merge-base — i.e. did the track
// genuinely progress through the lane pipeline independently, not just
// "some byte in this directory differs."
function mainHasReopenedTrackIndependently(repoRoot, mainBranch, branch, trackDir, trackNumber) {
  const base = git(['merge-base', branch, mainBranch], repoRoot).trim();
  if (!base) return false;
  const baseState = readTrackStateFromBranch(repoRoot, base, trackNumber);
  const mainState = readTrackStateFromBranch(repoRoot, mainBranch, trackNumber);
  if (!baseState || !mainState) return false;
  return baseState.lane !== mainState.lane || baseState.laneStatus !== mainState.laneStatus;
}

function wouldConflict(repoRoot, mainBranch, branch) {
  try {
    execFileSync('git', ['merge-tree', '--write-tree', mainBranch, branch], { cwd: repoRoot, stdio: 'pipe' });
    return false;
  } catch (err) {
    // merge-tree exits nonzero on a real conflict; anything else (e.g. the
    // branch/ref genuinely can't be merge-tree'd for an unrelated reason)
    // is treated the same way — conservative: don't call it mergeable
    // unless we positively confirmed a clean merge.
    return true;
  }
}

/**
 * Returns one row per unmerged track-* branch, plus one row per worktree
 * that has no track-* branch at all (detached HEAD, or a branch outside the
 * track-* naming convention): { trackNumber, branch, worktreePath,
 * hasWorktree, ahead, behind, dirtyCount, lane, laneStatus, title,
 * classification }. classification is one of:
 *   'open'        — track not yet done:success (working as designed)
 *   'mergeable'   — done:success, worktree present, clean merge available
 *   'stranded'    — done:success, worktree directory gone (RC-A)
 *   'conflicted'  — done:success, merge would conflict
 *   'detached'    — worktree present but no track-* branch to classify
 *                   against (e.g. a nested scratch worktree at a detached
 *                   HEAD) — never mergeable, since there is no branch to
 *                   merge.
 * Fully merged branches are omitted — nothing to report.
 * Read-only: never merges, deletes, or checks anything out.
 */
export async function auditWorktrees({ repoRoot, mainBranch = 'main' }) {
  const { byPath: worktreesByPath, primaryPath } = parsePorcelainWorktreeList(git(['worktree', 'list', '--porcelain'], repoRoot));
  const branchToWorktree = new Map();
  const worktreePathsWithTrackBranch = new Set();
  for (const [path, entry] of worktreesByPath) {
    const branchRef = entry.branch; // e.g. "refs/heads/track-101"
    const branchName = branchRef?.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : null;
    if (branchName?.match(/^track-\d+$/)) {
      branchToWorktree.set(branchName, path);
      worktreePathsWithTrackBranch.add(path);
    }
  }

  const branches = listTrackBranches(repoRoot);
  const rows = [];

  // Worktrees with no recognized track-* branch — detached HEAD or a branch
  // outside the naming convention. `git branch --list track-*` can never
  // surface these; they only show up by walking the worktree list itself.
  for (const [path] of worktreesByPath) {
    if (path === primaryPath) continue; // the primary checkout itself
    if (worktreePathsWithTrackBranch.has(path)) continue;
    const dirtyCount = git(['status', '--porcelain'], path).split('\n').filter(Boolean).length;
    rows.push({
      trackNumber: null, branch: worktreesByPath.get(path).branch ?? null, worktreePath: path,
      hasWorktree: true, ahead: null, behind: null, dirtyCount,
      lane: null, laneStatus: null, title: null, classification: 'detached',
    });
  }

  for (const branch of branches) {
    if (isAncestor(repoRoot, branch, mainBranch)) continue; // fully merged, nothing to report

    const trackNumber = branch.match(/^track-(\d+)$/)?.[1];
    if (!trackNumber) continue; // not a track branch we recognize (e.g. a detached-HEAD nested worktree has none)

    const state = readTrackStateFromBranch(repoRoot, branch, trackNumber);
    const worktreePath = branchToWorktree.get(branch) ?? null;
    const hasWorktree = worktreePath !== null;

    const ahead = countCommits(repoRoot, `${mainBranch}..${branch}`);
    const behind = countCommits(repoRoot, `${branch}..${mainBranch}`);
    const dirtyCount = hasWorktree
      ? git(['status', '--porcelain'], worktreePath).split('\n').filter(Boolean).length
      : null;

    const isDoneSuccess = state?.lane === 'done' && state?.laneStatus === 'success';
    const superseded = state?.trackDir
      ? mainHasReopenedTrackIndependently(repoRoot, mainBranch, branch, state.trackDir, trackNumber)
      : false;
    let classification;
    if (!isDoneSuccess || superseded) {
      classification = 'open';
    } else if (!hasWorktree) {
      classification = 'stranded';
    } else if (wouldConflict(repoRoot, mainBranch, branch)) {
      classification = 'conflicted';
    } else {
      classification = 'mergeable';
    }

    rows.push({
      trackNumber, branch, worktreePath, hasWorktree, ahead, behind, dirtyCount,
      lane: state?.lane ?? null, laneStatus: state?.laneStatus ?? null, title: state?.title ?? null,
      classification,
    });
  }

  return rows;
}
