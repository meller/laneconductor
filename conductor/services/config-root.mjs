// conductor/services/config-root.mjs
// Track 10064 (REQ-1/REQ-2/REQ-3): pure decision logic for where to read
// `.env`, `conductor/defaults.json`, and `.laneconductor.json` from.
//
// Before this, all three were read via bare relative paths, correct only
// because of an ordering accident: track 10019's chdir-to-primary (REQ-1,
// laneconductor.sync.mjs ~line 171) happens to run before these reads at
// module load. That accident does not cover a `--manager` worker (never
// chdir'd, by design — a manager isn't scoped to any project checkout) or
// a worker started with LC_SKIP_CWD_NORMALIZATION set. This gives those
// three reads their own explicit root instead of depending on the chdir
// having already happened.
//
// Deliberately takes `resolvePrimaryRepoRoot` as a parameter, same pattern
// as conductor/services/primary-cwd.mjs, so it's testable without a real
// git repo on disk for every case.

/**
 * @param {object} opts
 * @param {string} opts.cwd - the process's current working directory
 * @param {boolean} opts.isManager - true for a machine-level manager worker,
 *   which is never scoped to a project checkout and must never be redirected
 * @param {(dir: string) => string} opts.resolvePrimaryRepoRoot
 * @returns {string} the directory `.env` / defaults / project config should
 *   be read from — `cwd` whenever: isManager, cwd is already the primary,
 *   or the resolver throws (not inside a git repo / git unavailable).
 */
export function resolveConfigRoot({ cwd, isManager, resolvePrimaryRepoRoot }) {
  if (isManager) return cwd;
  try {
    return resolvePrimaryRepoRoot(cwd);
  } catch {
    return cwd;
  }
}
