// conductor/services/run-abort.mjs
// Track 10079: cancelling a live lane action / conversation turn.
//
// run-marker.mjs already gives every spawned CLI child a durable,
// cross-process liveness record (pid + pgid) and a pid-reuse-safe liveness
// check (isRunMarkerLive). What's missing is a way to (a) ask for a kill in a
// way that survives the kill itself, and (b) actually signal the detached
// process GROUP without ever risking an unrelated recycled-pid process.
//
// Pure module, no process-global state — OS probes (isPidAlive,
// readProcessCommand, kill, now) are injected params, mirroring
// run-marker.mjs's own testability style. abortRun() is the one exception
// that touches the filesystem directly (reads/writes the marker file),
// exactly like spawnCli itself does — there is nothing to inject there that
// isn't already covered by the OS-probe injections above.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runMarkerPath, parseRunMarker, isRunMarkerLive } from './run-marker.mjs';

// REQ-2: a read-modify-write over the marker already on disk. Preserves
// every existing field (pid, pgid, worker_pid, action, command,
// started_at, ...) — the exit handler and reconcileOrphanedDispatches both
// still depend on them being byte-identical to what spawnCli wrote.
export function writeAbortIntent(marker, { requestedBy = null, now = new Date() } = {}) {
  return {
    ...marker,
    abort_requested: true,
    abort_requested_at: now.toISOString(),
    abort_requested_by: requestedBy,
  };
}

// REQ-3: a marker with no `abort_requested` field classifies as no-intent —
// every marker written before this track behaves exactly as it does today.
export function readAbortIntent(marker) {
  if (!marker || !marker.abort_requested) return null;
  return {
    requestedAt: marker.abort_requested_at ?? null,
    requestedBy: marker.abort_requested_by ?? null,
  };
}

// REQ-5: SIGINT leads (what Ctrl+C sends — best chance the CLI flushes its
// own transcript), escalating toward SIGKILL. Terminal at SIGKILL: repeated
// calls once there stay there rather than erroring.
export function nextAbortStage(currentStage) {
  switch (currentStage) {
    case null:
    case undefined:
      return 'SIGINT';
    case 'SIGINT':
      return 'SIGTERM';
    case 'SIGTERM':
    case 'SIGKILL':
      return 'SIGKILL';
    default:
      return 'SIGINT';
  }
}

// REQ-5: env-override-first, same precedence as LC_SPAWN_TIMEOUT_MS.
export function getAbortGraceConfig() {
  return {
    sigintGraceMs: Number(process.env.LC_ABORT_SIGINT_GRACE_MS) || 5000,
    sigtermGraceMs: Number(process.env.LC_ABORT_SIGTERM_GRACE_MS) || 5000,
  };
}

// REQ-4: refuses to signal unless isRunMarkerLive says live, and refuses any
// pgid that isn't an integer > 1 (0/1/negative/non-numeric/missing all mean
// "this is not a process group we may touch"). Signals the NEGATED pgid —
// the whole group — never a bare pid.
export function signalRunGroup(marker, { stage, isPidAlive, readProcessCommand, kill }) {
  const liveness = isRunMarkerLive(marker, { isPidAlive, readProcessCommand });
  if (!liveness.live) return { ok: false, reason: liveness.reason || 'not-live' };

  const pgid = marker.pgid;
  if (!Number.isInteger(pgid) || pgid <= 1) return { ok: false, reason: 'invalid-pgid' };

  kill(-pgid, stage);
  return { ok: true, pid: marker.pid, pgid, signal: stage };
}

// Task 1.2: the one entry point both the API route and the CLI call, so the
// two cannot drift. Reads the marker from disk, writes the abort intent
// BEFORE sending anything (REQ-6 — the intent must survive the kill even if
// the child dies before this function returns), sends the next escalation
// stage, and — unless this call already reached SIGKILL — schedules a
// single follow-up check after the stage's grace window: if the group is
// still live then, it escalates again by calling itself. Never awaited by
// the caller; the caller only waits for the FIRST signal to land.
export async function abortRun({
  primaryRoot,
  trackNumber,
  requestedBy = null,
  isPidAlive,
  readProcessCommand,
  kill,
  now = () => new Date(),
  // Set only by this function's own scheduled escalation continuation
  // (below) — never passed by an external caller. Guards against exactly
  // the scenario a resumed track creates: the ORIGINAL run's grace-window
  // timer is still pending when the track is parked, resumed, and reclaimed
  // by a brand-new run (same track number, different pid) before that timer
  // fires. Without this check the stale continuation would read whatever
  // marker currently sits at this track's path and escalate onto a run it
  // was never asked to stop.
  expectPid = null,
}) {
  const markerPath = runMarkerPath(primaryRoot, trackNumber);
  if (!existsSync(markerPath)) return { ok: false, reason: 'no-marker' };

  const marker = parseRunMarker(readFileSync(markerPath, 'utf8'));
  if (!marker) return { ok: false, reason: 'no-marker' };
  if (expectPid != null && marker.pid !== expectPid) return { ok: false, reason: 'different-run' };

  const liveness = isRunMarkerLive(marker, { isPidAlive, readProcessCommand });
  if (!liveness.live) return { ok: false, reason: liveness.reason || 'not-live' };

  const alreadyRequested = !!marker.abort_requested;
  const stage = nextAbortStage(marker.abort_stage ?? null);
  const updated = { ...writeAbortIntent(marker, { requestedBy, now: now() }), abort_stage: stage };
  writeFileSync(markerPath, JSON.stringify(updated, null, 2), 'utf8');

  const result = signalRunGroup(updated, { stage, isPidAlive, readProcessCommand, kill });
  if (!result.ok) return result;

  if (stage !== 'SIGKILL') {
    const { sigintGraceMs, sigtermGraceMs } = getAbortGraceConfig();
    const graceMs = stage === 'SIGINT' ? sigintGraceMs : sigtermGraceMs;
    setTimeout(() => {
      abortRun({ primaryRoot, trackNumber, requestedBy, isPidAlive, readProcessCommand, kill, now, expectPid: marker.pid }).catch(() => { });
    }, graceMs).unref?.();
  }

  return result.ok
    ? { ok: true, pid: result.pid, pgid: result.pgid, signal: result.signal, ...(alreadyRequested ? { already_requested: true } : {}) }
    : result;
}
