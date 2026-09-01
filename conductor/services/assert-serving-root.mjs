// conductor/services/assert-serving-root.mjs
// Track 10045 Phase 2 (REQ-3): pure comparison logic behind the opt-in
// LC_ASSERT_SERVING_ROOT startup guard. Extracted so it's unit-testable
// without spawning laneconductor.sync.mjs (that file runs setIntervals,
// chokidar watchers, and other side effects on import — see
// conductor/services/path-isolation.mjs's identical note for the same
// reason).
//
// Both sides are realpath-normalized so a symlinked tmpdir (e.g. macOS
// /var -> /private/var) or a trailing slash never produces a false
// mismatch — the guard exists to catch a REAL escape, not path spelling.

import { realpathSync } from 'node:fs';

function normalize(p) {
  const stripped = p.replace(/\/+$/, '');
  try {
    return realpathSync(stripped).replace(/\/+$/, '');
  } catch {
    // Path doesn't exist on disk — shouldn't happen for a real process.cwd(),
    // but degrade to a raw compare rather than throwing out of a startup guard.
    return stripped;
  }
}

/**
 * @param {string} expected - LC_ASSERT_SERVING_ROOT's raw value
 * @param {string} actual - process.cwd() after cwd normalization
 * @returns {{ ok: boolean, expected: string, actual: string }} normalized
 *   expected/actual are returned too, so a caller can log exactly what was
 *   compared without re-deriving it.
 */
export function checkServingRoot(expected, actual) {
  const normExpected = normalize(expected);
  const normActual = normalize(actual);
  return { ok: normExpected === normActual, expected: normExpected, actual: normActual };
}
