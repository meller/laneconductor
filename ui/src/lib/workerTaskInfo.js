// ui/src/lib/workerTaskInfo.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (free text set by
// updateWorkerHeartbeat, laneconductor.sync.mjs) into what
// WorkerActivityLatch should show for that worker.

export function parseWorkerTask(currentTask) {
  if (!currentTask) return null;

  // Track 1091 Phase 5: create-project's current_task also matches the
  // generic "(dispatch N)" pattern below, but it isn't a deploy — it has
  // no project to scope DeployLogView's endpoint to (that's the whole
  // point of the dispatch). Must be checked first.
  if (currentTask.startsWith('create-project ')) {
    const m = currentTask.match(/\(dispatch (\d+)\)/);
    if (m) return { kind: 'create-project', dispatchId: m[1] };
  }

  const dispatchMatch = currentTask.match(/\(dispatch (\d+)\)/);
  if (dispatchMatch) return { kind: 'deploy', dispatchId: dispatchMatch[1] };

  const trackMatch = currentTask.match(/track (\S+)$/);
  if (trackMatch) return { kind: 'track', trackNumber: trackMatch[1] };

  return null;
}

// Track 10037 REQ-5/REQ-7: which track should a chat with this worker be
// scoped to? Running track wins (parseWorkerTask(current_task)); otherwise
// fall back to the last track the worker holds a warm session for
// (last_track_number, from track_sessions — see the /api/workers /
// /api/projects/:id/workers enrichment). Idle workers with no last-context
// track have nothing to talk about — null, not a guess.
//
// Track 10069 REQ-25: a manager resolves to the reserved 'manager'
// pseudo-track (10067 REQ-14/REQ-21) instead of null. A manager's own
// worker.project_id is null by construction (laneconductor.sync.mjs:1259)
// and it appears on every project's worker list, so its target is scoped
// to fallbackProjectId — "the manager's supervision thread for the project
// I'm looking at" — never worker.project_id, which would always be null.
export function resolveWorkerChatTarget(worker, fallbackProjectId) {
  if (!worker) return null;
  if (worker.type === 'manager') {
    return { trackNumber: 'manager', projectId: fallbackProjectId, source: 'manager' };
  }

  const task = parseWorkerTask(worker.current_task);
  if (task?.kind === 'track') {
    return {
      trackNumber: task.trackNumber,
      projectId: worker.project_id ?? fallbackProjectId,
      source: 'running',
    };
  }

  if (worker.last_track_number) {
    return {
      trackNumber: worker.last_track_number,
      projectId: worker.last_track_project_id ?? worker.project_id ?? fallbackProjectId,
      source: 'last',
    };
  }

  return null;
}

// Track 10069 Phase 6 (REQ-9..REQ-11, Task 6.1): derive target run liveness
// (whether a run is actively in-flight on the target's track) and what action
// it is running. Pure derivation from transcript turn, workers list, and tracks list.
export function resolveTargetRunLiveness({ target, workers = [], tracks = [], turn = null } = {}) {
  if (!target || !target.trackNumber) {
    return { isLive: false, action: null };
  }

  const trackNumStr = String(target.trackNumber);

  // 1. Live stream-json turn active in transcript (via WS session:event)
  if (turn?.active) {
    return {
      isLive: true,
      action: turn.activity || 'turn',
    };
  }

  // 2. Active busy worker on this track
  for (const w of workers) {
    if (w && w.status === 'busy' && w.current_task) {
      const task = parseWorkerTask(w.current_task);
      if (task?.kind === 'track' && String(task.trackNumber) === trackNumStr) {
        const m = w.current_task.match(/^(?:auto-)?(\S+)\s+track\s+/i);
        let action = m ? m[1] : null;
        if (action === 'local-fs-answer' || action === 'conversation-reply') {
          action = 'reply';
        }
        return {
          isLive: true,
          action: action || 'busy',
        };
      }
    }
  }

  // 3. Track lane_action_status is running (for numbered tracks)
  if (trackNumStr !== 'manager' && Array.isArray(tracks)) {
    const matchedTrack = tracks.find(t => String(t.track_number) === trackNumStr);
    if (matchedTrack && matchedTrack.lane_action_status === 'running') {
      return {
        isLive: true,
        action: matchedTrack.lane_status || 'running',
      };
    }
  }

  return { isLive: false, action: null };
}
