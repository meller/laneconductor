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
// /api/projects/:id/workers enrichment). Managers and idle workers with no
// last-context track have nothing to talk about — null, not a guess.
export function resolveWorkerChatTarget(worker, fallbackProjectId) {
  if (!worker || worker.type === 'manager') return null;

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
