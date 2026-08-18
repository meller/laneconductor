// conductor/services/primary-cwd.mjs
// Track 10019 (REQ-1/REQ-1a): pure decision logic for whether a
// long-running process should chdir to the primary checkout before doing
// any relative-path work. Extracted out of laneconductor.sync.mjs's
// top-level startup code so it's importable and testable in isolation —
// that file can't be imported directly in a test (module-load side
// effects: setInterval, chokidar — see worktree-create-path-resolution.test.mjs's
// own note on this).
//
// Deliberately takes `resolvePrimaryRepoRoot` as a parameter rather than
// importing it directly, so a test can stub it without needing a real git
// repo on disk for every case (e.g. the "not in a git repo" / "resolver
// throws" path).

/**
 * Decides whether the caller should chdir before continuing.
 *
 * @param {object} opts
 * @param {string} opts.cwd - the process's current working directory
 * @param {boolean} opts.isManager - true for a machine-level manager worker,
 *   which isn't scoped to any project checkout and must never be redirected
 * @param {(dir: string) => string} opts.resolvePrimaryRepoRoot
 * @returns {{ shouldChdir: boolean, primaryRoot: string|null, launchCwd: string }}
 *   shouldChdir is false whenever: isManager, cwd is already the primary,
 *   or the resolver throws (not inside a git repo / git unavailable) —
 *   REQ-1a: all three degrade to "leave cwd alone", never a crash.
 */
export function resolvePrimaryCwdDecision({ cwd, isManager, resolvePrimaryRepoRoot }) {
  if (isManager) {
    return { shouldChdir: false, primaryRoot: null, launchCwd: cwd };
  }
  try {
    const primaryRoot = resolvePrimaryRepoRoot(cwd);
    return { shouldChdir: primaryRoot !== cwd, primaryRoot, launchCwd: cwd };
  } catch {
    return { shouldChdir: false, primaryRoot: null, launchCwd: cwd };
  }
}
