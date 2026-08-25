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
