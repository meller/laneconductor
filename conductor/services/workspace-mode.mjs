// conductor/services/workspace-mode.mjs
// Track 1115: per-track workspace mode — 'main' (run in the primary
// checkout, no worktree, no track branch) vs 'branch' (today's default:
// lock -> worktree -> track branch -> merge at done).
//
// Pure module, no I/O — mirrors path-isolation.mjs's extraction style so
// it's importable/testable without pulling in laneconductor.sync.mjs's
// module-load side effects (setInterval, chokidar).
//
// resolveWorkspaceMode() is the ONLY place D5's precedence table lives.
// See conductor/tracks/1115-workspace-mode-main-vs-branch/spec.md D5 for
// the full table and D1 for why rows 2/3/4 are ordered the way they are:
// an EXPLICIT `**Workspace**` marker (row 2) outranks the auto-queue/
// auto-complete override (row 3), but the TYPE-DERIVED bug->main default
// (row 4) does not. An explicit marker is a human decision; a type-derived
// default is an inference, and an unattended queue claim should not act on
// an inference alone.

export const VALID_MODES = ['main', 'branch'];

// Mirrors merge-mode.mjs's parseMergeModeMarker() shape/behavior exactly —
// returns null for absent/invalid rather than a default, so the resolver
// can distinguish "unset" from "explicitly branch" (D2).
export function parseWorkspaceMarker(content) {
  const match = content.match(/\*\*Workspace\*\*:\s*([a-z]+)/i);
  if (!match) return null;
  const value = match[1].toLowerCase().trim();
  return VALID_MODES.includes(value) ? value : null;
}

// Track 1115, discovered during implementation (not in the original spec):
// the New Track modal's bug/feature `type` selector is NOT the same field
// as `**Type**` in index.md (that marker holds dev/marketing/sales/
// support/other — a completely different axis, parsed by parseTrackType()
// elsewhere in the worker). Nothing durably persisted bug-vs-feature
// anywhere before this track. Writing that classification straight into
// `**Workspace**` at creation (an earlier draft of this file's REQ-6) would
// have made every UI-created bug track's marker indistinguishable from a
// human's deliberate choice — silently defeating D1's whole point: an
// auto-queue claim must be able to tell "inferred from type" apart from
// "a human explicitly set this." `**Track Kind**` is a new, narrow marker
// that exists ONLY to preserve that distinction; it is not a general track
// classification and nothing else should read it.
export function parseTrackKind(content) {
  const match = content.match(/\*\*Track Kind\*\*:\s*([a-z]+)/i);
  if (!match) return null;
  const value = match[1].toLowerCase().trim();
  return ['bug', 'feature'].includes(value) ? value : null;
}

const UNATTENDED_TRIGGERS = ['auto-queue', 'auto-complete'];

/**
 * Resolves the effective workspace mode for one lane action.
 *
 * @param {object} opts
 * @param {string} opts.laneStatus - the lane this action runs in (e.g. 'plan', 'implement')
 * @param {string|null} opts.workspaceMarker - result of parseWorkspaceMarker(), or null if unset
 * @param {string|null} [opts.trackType] - 'bug' | 'feature' | null/other
 * @param {string} [opts.trigger] - 'auto-queue' | 'auto-complete' | 'manual-dispatch'
 * @param {string|null} [opts.projectWorkspaceMode] - `.laneconductor.json`'s project.workspace_mode
 * @returns {'main'|'branch'}
 */
export function resolveWorkspaceMode({
  laneStatus,
  workspaceMarker = null,
  trackType = null,
  trigger = null,
  projectWorkspaceMode = null,
} = {}) {
  // D5 row 1 / D6: plan is always main-direct, for every track, unconditionally —
  // checked first so it outranks even an explicit **Workspace**: branch marker.
  if (laneStatus === 'plan') return 'main';

  // Track 10035 REQ-3: done (the merge action) is always main-direct too,
  // for the same reason and at the same precedence tier as plan — there is
  // nothing to run in a track's own worktree when the entire point of the
  // run is to integrate that worktree's branch into main. Outranks even an
  // explicit **Workspace**: branch marker.
  if (laneStatus === 'done') return 'main';

  // D5 row 2 / D1: an explicit marker is a human decision and wins over
  // everything below, INCLUDING the auto-queue/auto-complete override in
  // row 3. This is deliberate: forcing 'branch' on a track explicitly
  // marked 'main' doesn't produce a safe run, it produces a wrong one (an
  // infra track is marked main precisely because a branch run can't do
  // its job).
  if (workspaceMarker === 'main' || workspaceMarker === 'branch') {
    return workspaceMarker;
  }

  // D5 row 3 / D1: an unattended trigger forces 'branch' — but only over
  // the type-derived default below (row 4), which is an inference rather
  // than a human decision.
  if (UNATTENDED_TRIGGERS.includes(trigger)) return 'branch';

  // D5 row 4 / D3: bug tracks default to main for manually-launched runs.
  if (trackType === 'bug') return 'main';

  // D5 row 5 / D4: project-level default.
  if (projectWorkspaceMode === 'main' || projectWorkspaceMode === 'branch') {
    return projectWorkspaceMode;
  }

  // D5 row 6: today's behavior for every track that sets nothing.
  return 'branch';
}

// D10/REQ-10: main mode must refuse to start on a dirty checkout — any
// dirty path outside the track's own folder risks an agent's commit
// sweeping in unrelated human WIP.
//
// Dogfooding 2026-08-25: this guard blocked EVERY plan-lane spawn,
// repeatedly, on a heavily-parallel dogfooding run — not because of real
// WIP, but because OTHER tracks' own index.md/plan.md/spec.md/test.md are
// under continuous routine rewrite by this exact sync worker's own normal
// DB->file sync (every track action anywhere touches its own status
// markers). That's the identical shape as the worker's own runtime
// bookkeeping (.sync.pid etc, tracks-metadata.json, file_sync_queue.md —
// discovered earlier, Track 10021) already exempted below: machine-
// generated, routinely committed via this codebase's own "chore: sync
// track state" pattern, never human/agent WIP a commit could dangerously
// sweep in. conversation.md is deliberately NOT included — unlike the
// other four, a human can genuinely have an uncommitted, in-progress edit
// there that this guard exists to protect.
// Track 1119 root-cause fix (2026-08-26): resolveTrackFolder() now
// quarantines a stale duplicate track folder by renaming it to
// `_duplicate-<name>` the moment it's discovered — a machine-generated
// side effect of resolving ANY track's folder, not a deliberate edit
// scoped to the track actually being dispatched. Without this exemption,
// quarantining one track's stale folder could spuriously block a totally
// unrelated main-mode dispatch's dirty-checkout guard — the exact same
// false-positive-friction shape the four exemptions above were already
// built to solve.
//
// Track 10020 investigation (2026-08-27): .conv-cursor (and its .lock)
// churns on every conversation.md sync — same routine-machine-write shape
// as index/plan/spec/test.md above — but 27 of them were committed to git
// before .conv-cursor was added to .gitignore, so git status --porcelain
// still reports them as dirty on every advance. Exempted here alongside
// the file itself being untracked (git rm --cached) so this doesn't
// recur even where a stray .conv-cursor slips back into the index.
// Dogfooding 2026-08-30: found live running a fresh wizard-generated
// project with multiple Auto Run tracks — .laneconductor.json is rewritten
// by this exact worker's own normal registration/config-sync (same
// machine-generated, routinely-rewritten shape as the conductor/.* dotfiles
// above, just rooted one level up instead of under conductor/), so it
// perpetually shows dirty and perpetually blocked every plan-lane spawn in
// that project — never real human/agent WIP a commit could dangerously
// sweep in, same reasoning as every exemption above.
export function isWorkerBookkeepingPath(p) {
  return /^conductor\/\.[^/]+$/.test(p)
    || p === '.laneconductor.json'
    || p === 'conductor/tracks-metadata.json'
    || p === 'conductor/tracks/file_sync_queue.md'
    || /^conductor\/tracks\/[^/]+\/(index|plan|spec|test)\.md$/.test(p)
    || /^conductor\/tracks\/[^/]+\/\.conv-cursor(\.lock)?$/.test(p)
    || /^conductor\/tracks\/_duplicate-[^/]+\/?/.test(p);
}

/**
 * Filters a track's own folder and known worker-bookkeeping/routine-sync
 * paths out of a raw `git status --porcelain` path list, returning only
 * the paths that genuinely disqualify a main-mode spawn.
 *
 * @param {string[]} dirtyPaths     porcelain-parsed paths (no status prefix)
 * @param {string|null} ownFolderPrefix  e.g. `conductor/tracks/042-foo/`, or null
 */
export function findDisqualifyingDirtyPaths(dirtyPaths, ownFolderPrefix) {
  return dirtyPaths.filter(p =>
    (!ownFolderPrefix || !p.startsWith(ownFolderPrefix)) && !isWorkerBookkeepingPath(p)
  );
}
