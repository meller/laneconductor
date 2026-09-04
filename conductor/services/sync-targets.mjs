// conductor/services/sync-targets.mjs
// Track 10051: the compatibility seam for the 'collectors' -> 'targets'
// rename. This is the ONLY place the legacy names are read.
//
// Why a shared module instead of an inline `?? config.collectors` at each
// call site: config was previously parsed independently in six places
// (bin/lc.mjs, laneconductor.sync.mjs, lock.mjs, unlock.mjs,
// collector/index.mjs, ProjectConfigSettings.jsx). Six hand-rolled
// fallbacks drift — one of them eventually forgets the legacy key and
// silently stops syncing for every user who never re-ran `lc setup`.
//
// The rename is dual-read / single-write, because the old names are
// already on users' disks and, for tokens, in CI secrets and GCP Secret
// Manager entries this codebase cannot reach:
//   - read  `targets ?? collectors`, preferring `targets`
//   - write only `targets`, dropping `collectors` in the same write
//   - NEVER rewrite a user's .env (see resolveTargetToken's note)
//
// Pure module, no I/O beyond process.env reads — mirrors
// workspace-mode.mjs's extraction style so it's importable without
// pulling in laneconductor.sync.mjs's module-load side effects.

/**
 * The sync targets configured for a project.
 *
 * Prefers the modern `targets` key; falls back to the legacy `collectors`
 * key so an unmigrated `.laneconductor.json` keeps working untouched.
 *
 * Note the `Array.isArray` check rather than a plain `??`: an explicitly
 * empty `targets: []` is how a project is deliberately put into local-fs
 * mode, and must NOT fall through to a stale `collectors` array — doing so
 * would silently resurrect sync the user turned off.
 *
 * @param {object|null|undefined} config - parsed .laneconductor.json
 * @returns {Array<object>} never null; [] when nothing is configured
 */
export function readTargets(config) {
  if (!config) return [];
  if (Array.isArray(config.targets)) return config.targets;
  if (Array.isArray(config.collectors)) return config.collectors;
  return [];
}

/**
 * Sets the sync targets on a config object, migrating the legacy key away.
 *
 * Mutates `config` in place (callers already hold the parsed object and
 * write it back themselves). Dropping `collectors` here is deliberate: it
 * is an opportunistic migration riding along on a write the user already
 * triggered (`lc add-target`, saving Project Configuration), never a
 * standalone rewrite pass over their file. Leaving the legacy key behind
 * would make readTargets ambiguous forever.
 *
 * @param {object} config - parsed .laneconductor.json (mutated)
 * @param {Array<object>} targets
 * @returns {object} the same config object, for chaining
 */
export function writeTargets(config, targets) {
  config.targets = targets;
  delete config.collectors;
  return config;
}

/**
 * Resolves the auth token for the target at `idx` from the environment.
 *
 * Tries TARGET_<n>_TOKEN, then the legacy COLLECTOR_<n>_TOKEN. The legacy
 * fallback is permanent, not transitional: these tokens live in users'
 * .env files, in CI secrets, and in GCP Secret Manager entries, and the
 * worker deliberately never rewrites .env — silently editing a file full
 * of secrets is not a migration we get to perform on someone's behalf.
 * `lc setup` / `lc add-target` write the new name for NEW tokens only.
 *
 * An empty-string value counts as absent: a bare `COLLECTOR_0_TOKEN=` line
 * is common in hand-edited .env files, and sending `Authorization: Bearer `
 * is worse than sending no header at all.
 *
 * @param {number} idx - target index within the targets array
 * @returns {string|null}
 */
export function resolveTargetToken(idx) {
  return process.env[`TARGET_${idx}_TOKEN`] || process.env[`COLLECTOR_${idx}_TOKEN`] || null;
}

/**
 * Resolves a non-token TARGET_ / COLLECTOR_ environment variable.
 *
 * Same dual-read rule as resolveTargetToken, for PORT / URL / TOKEN_ENV
 * and friends. Pass the bare suffix ('PORT'), not the full var name.
 *
 * @param {string} name - e.g. 'PORT', 'URL', 'TOKEN_ENV'
 * @returns {string|null}
 */
export function resolveTargetEnv(name) {
  return process.env[`TARGET_${name}`] || process.env[`COLLECTOR_${name}`] || null;
}
