// conductor/services/run-marker.mjs
// Track 10020: a persistent, cross-process liveness signal for the CLI
// child spawnCli() launches. runningTrackMap (laneconductor.sync.mjs) is
// the in-memory equivalent of "is this track's CLI still alive" — but it
// lives in the process that spawned the child, which is exactly the
// process that's GONE in the bug this track fixes (a worker restarts
// while a dispatched lane action's detached CLI child keeps running).
// reconcileOrphanedDispatches()'s periodic tick needs a REPLACEMENT
// process to be able to ask "is my predecessor's child still alive?" —
// this module mirrors runningTrackMap to disk at spawn time so it can.
//
// Pure module, no process-global state — mirrors workspace-mode.mjs's
// extraction style (path/serialize helpers + a liveness check that takes
// its OS probes as injected params, so it's unit-testable without a real
// process to check).

import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function runMarkerPath(primaryRoot, trackNumber) {
  return join(primaryRoot, 'conductor', '.runs', `${trackNumber}.json`);
}

export function buildRunMarker({ pid, pgid, workerPid, trackNumber, dispatchId = null, action = null, command, now = new Date() }) {
  return {
    pid,
    pgid,
    worker_pid: workerPid,
    track_number: trackNumber,
    dispatch_id: dispatchId,
    action,
    command,
    started_at: now.toISOString(),
  };
}

// Tolerant on purpose: a corrupt/partial marker (e.g. a crash mid-write)
// must never take the periodic reconcile loop down — treat it the same as
// "no marker" rather than throwing.
export function parseRunMarker(json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.pid !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

// REQ-2: pid alive AND the live process's command still looks like the one
// the marker recorded. process.kill(pid, 0) alone is not sufficient — pid
// reuse would make a long-dead run look live forever, permanently blocking
// reconciliation of that track. An unreadable command fails OPEN toward
// reconciling (never blocks forever), not closed.
export function isRunMarkerLive(marker, { isPidAlive, readProcessCommand } = {}) {
  if (!marker) return { live: false };
  if (!isPidAlive(marker.pid)) return { live: false, reason: 'pid-gone' };
  const currentCommand = readProcessCommand(marker.pid);
  if (currentCommand == null) return { live: false, reason: 'command-unreadable' };
  if (!currentCommand.includes(marker.command)) return { live: false, reason: 'command-mismatch' };
  return { live: true };
}

// Track 10065: the exit handler used to delete the marker at the very top of
// proc.on('exit'), before ~690 lines of async finalization (retry counts, the
// action PATCH, artifact copy, git-lock release, dispatch finalization). A
// worker killed anywhere in that tail left no marker at all — indistinguishable
// from a claim that never got as far as spawning — even though the CLI child
// had, in fact, already finished. Rewriting the marker to record that
// finalization is IN PROGRESS (rather than deleting it outright) closes that
// window: a replacement process can now tell "still finalizing, leave it
// alone" (the finalizing worker is still the sole finalizer, same as
// activeDispatch/runningTrackMap for the in-process case) apart from "was
// finalizing, but that worker died too" (positive evidence, stronger than an
// absent marker — no need to wait out the no-marker fallback window).
export function markRunFinalizing(marker, { exitCode = null, now = new Date() } = {}) {
  return {
    ...marker,
    finalizing: true,
    exited_at: now.toISOString(),
    exit_code: exitCode,
  };
}

// A marker with no `finalizing` field (every marker written before this
// track, or one still mid-run) classifies as 'running' — byte-identical to
// this function not existing at all. Only a marker THIS module itself wrote
// via markRunFinalizing ever has `finalizing: true`, so a legacy caller sees
// zero behavior change.
export function classifyMarkerPhase(marker, { isPidAlive } = {}) {
  if (!marker) return 'running';
  if (!marker.finalizing) return 'running';
  return isPidAlive(marker.worker_pid) ? 'finalizing-live' : 'finalizing-dead';
}

// ESRCH means no such process — genuinely gone. Any other error (notably
// EPERM) means the pid exists but isn't ours to signal, which still counts
// as "alive" for this purpose.
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

// Returns null on any failure (missing `ps`, permission denied, pid raced
// out from under us) rather than throwing — isRunMarkerLive treats that as
// not-live, same fail-open reasoning as above.
export function readProcessCommand(pid) {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
