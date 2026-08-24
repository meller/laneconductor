// conductor/services/worker-lock.mjs
// Track 1110 Phase 2, Tasks 5-8: exclusivity for a worker identity
// (project + worker_number, or the machine-level manager), independent
// of the pidfile bin/lc.mjs's start/stop commands read and write.
//
// Why this exists alongside the stop/restart fix (Tasks 1-4): that fix
// closes the case where `lc stop` itself was involved but returned too
// early. It does nothing for a pidfile that has simply drifted wrong for
// any other reason — pointing at a phantom pid, or at a process that
// hung without ever being told to stop at all. Confirmed live twice this
// session (see plan.md's Phase 2 notes) — including once *while writing
// this file*, a hung 9h13m-old worker whose pidfile had already drifted
// to point at an unrelated, already-dead pid.
//
// The lock must be acquired and HELD by the long-running worker process
// itself, not by `lc worker start` — `start` spawns the worker detached
// and exits almost immediately, so it cannot hold anything "for the
// process's entire lifetime." Only the worker persists.
//
// Not true kernel-level flock (Node has no built-in binding for it, and
// shelling out to flock(1) isn't portable to macOS by default). Instead,
// proper-lockfile: atomic mkdir-based acquisition (no TOCTOU gap) plus an
// internally-managed mtime refresh for as long as the lock is held, so a
// live process's lock never goes stale on its own. A dead process's lock
// becomes stealable once `stale` ms pass without a refresh — a bounded
// window, not "wrong forever" the way an unmonitored pidfile is.

import lockfile from 'proper-lockfile';
import { existsSync, closeSync, openSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Comfortably above any legitimate heartbeat gap (the worker's own
// heartbeat interval is 10s) so a live-but-briefly-slow worker is never
// mistaken for dead and has its lock stolen out from under it.
export const DEFAULT_STALE_MS = 60000;

// Track 1117 Bug 4: proper-lockfile refreshes this lock's mtime on an
// internal timer for as long as it's held, entirely outside the
// acquireWorkerLock() call above (which only wraps the INITIAL .lock()
// call). If that periodic refresh ever fails — confirmed live, "Unable to
// update lock within the stale threshold" — the library's own default
// onCompromised handler is `(err) => { throw err; }`, thrown from that
// internal timer with no surrounding try/catch of ours to catch it. It
// still reaches this process's `uncaughtException` handler (Node doesn't
// silently drop it), but that handler is generic and shared with every
// OTHER kind of crash — this needs a dedicated, distinguishable log line
// and its own deliberate cleanup path, not to be lumped in as "some
// uncaught exception happened."
function defaultOnCompromised(err) {
  console.error(`[worker-lock] Lock compromised (${err.message}) — exiting cleanly rather than continuing with an unrefreshable lock.`);
  process.exit(1);
}

/**
 * Attempts to acquire an exclusive lock at `lockTargetPath`, creating the
 * target file if it doesn't exist (proper-lockfile locks an existing
 * path, not an arbitrary one). Returns a `release()` function on success,
 * or `null` if another live process already holds it — callers should
 * treat `null` as "already running" and exit rather than retry silently.
 *
 * `onCompromised` (optional): called if the lock's background mtime-refresh
 * fails while held (e.g. the lock file/dir was deleted or stolen out from
 * under this process). Defaults to logging and exiting this process
 * cleanly — see `defaultOnCompromised` above. Pass your own to run
 * additional cleanup (e.g. de-registering from a collector) before exiting;
 * re-acquiring the SAME logical hold in place isn't supported by
 * proper-lockfile (a fresh `.lock()` call mints a new, separate
 * release/lock pair, leaving the caller's original `release()` reference
 * stale) so this is intentionally an exit path, not a retry loop.
 */
export async function acquireWorkerLock(lockTargetPath, { staleMs = DEFAULT_STALE_MS, onCompromised = defaultOnCompromised } = {}) {
  mkdirSync(dirname(lockTargetPath), { recursive: true });
  if (!existsSync(lockTargetPath)) {
    closeSync(openSync(lockTargetPath, 'w'));
  }
  try {
    return await lockfile.lock(lockTargetPath, { stale: staleMs, retries: 0, onCompromised });
  } catch (err) {
    return null;
  }
}
