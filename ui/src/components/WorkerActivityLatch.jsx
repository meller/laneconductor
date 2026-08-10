import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TranscriptView } from './TranscriptView.jsx';
import { DeployLogView } from './DeployLogView.jsx';
import { createTranscriptState, reduceStreamEvent } from '../lib/streamTranscript.js';
import { parseWorkerTask } from '../lib/workerTaskInfo.js';
import { useApi } from '../hooks/useApi.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

// Track 1087 Phase 5: a global, worker-centric side latch — reachable from
// anywhere in the app, not nested inside a track's own detail panel. Lists
// every worker on the left; selecting one shows ITS live transcript inline
// on the right, without navigating away. Distinct from Phase 4's per-track
// drawer (which stays as the "open a specific track, see its transcript"
// path) — this is "see what any of my workers is doing right now".
//
// Phase 6: a worker can also be running a non-track `deploy` dispatch —
// parseWorkerTask distinguishes the two so this component can show the
// right content pane (structured transcript vs. raw deploy log) instead
// of just falling through to "idle".

const WORKER_OFFLINE_MS = 60_000;

function isWorkerOffline(worker) {
  if (!worker?.last_heartbeat) return true;
  return Date.now() - new Date(worker.last_heartbeat).getTime() > WORKER_OFFLINE_MS;
}

export function WorkerActivityLatch({ workers, projectId, onClose }) {
  const { apiFetch } = useApi();
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [transcriptState, setTranscriptState] = useState(() => createTranscriptState());
  const transcriptEndRef = useRef(null);

  const selectedWorker = workers.find(w => w.id === selectedWorkerId) ?? null;
  const selectedTask = parseWorkerTask(selectedWorker?.current_task);
  const selectedTrackNumber = selectedTask?.kind === 'track' ? selectedTask.trackNumber : null;
  // /api/workers (all-projects) returns project_id per worker; the
  // per-project /api/projects/:id/workers doesn't need to (it's already
  // scoped) — fall back to the currently selected project in that case.
  const selectedProjectId = selectedWorker?.project_id ?? projectId;

  useEffect(() => {
    setTranscriptState(createTranscriptState());
    if (!selectedProjectId || !selectedTrackNumber) return;
    apiFetch(`/api/projects/${selectedProjectId}/tracks/${selectedTrackNumber}/transcript`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(({ events }) => {
        setTranscriptState((events || []).reduce(reduceStreamEvent, createTranscriptState()));
      })
      .catch(() => { });
  }, [selectedProjectId, selectedTrackNumber]);

  const onWsMessage = useCallback((msg) => {
    if (msg.event !== 'session:event') return;
    if (!selectedTrackNumber || String(msg.data?.trackNumber) !== String(selectedTrackNumber)) return;
    setTranscriptState(prev => reduceStreamEvent(prev, msg.data.event));
  }, [selectedTrackNumber]);
  useWebSocket(onWsMessage);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptState]);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-3xl bg-gray-950 border-l border-gray-800 z-50 flex flex-row shadow-2xl">
        {/* Worker list */}
        <div className="w-64 border-r border-gray-800 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Workers</span>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-sm leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {workers.length === 0 ? (
              <p className="text-gray-600 text-xs italic px-4 py-3">No workers online.</p>
            ) : (
              workers.map(w => {
                const task = parseWorkerTask(w.current_task);
                const offline = isWorkerOffline(w);
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelectedWorkerId(w.id)}
                    className={`w-full text-left px-4 py-2.5 border-b border-gray-900 text-xs transition-colors ${selectedWorkerId === w.id ? 'bg-gray-800' : 'hover:bg-gray-900'
                      }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${offline ? 'bg-gray-600' : w.status === 'busy' ? 'bg-orange-400' : 'bg-green-500'
                          }`}
                      />
                      <span className="font-medium text-gray-300 truncate">
                        {w.hostname}{w.project_name ? ` · ${w.project_name}` : ''}
                      </span>
                    </div>
                    <div className="text-gray-500 truncate mt-0.5 pl-3">
                      {offline
                        ? 'offline'
                        : task?.kind === 'track'
                          ? `#${task.trackNumber} — ${w.current_task}`
                          : task?.kind === 'deploy'
                            ? `🚀 ${w.current_task}`
                            : (w.current_task || 'idle')}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Selected worker's live activity */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!selectedWorker ? (
            <p className="text-gray-600 text-sm italic pt-4">Select a worker to see its live activity.</p>
          ) : selectedTask?.kind === 'track' ? (
            <>
              <div className="text-xs text-gray-500 mb-3">Track #{selectedTask.trackNumber}</div>
              <TranscriptView blocks={transcriptState.blocks} />
              <div ref={transcriptEndRef} />
            </>
          ) : selectedTask?.kind === 'deploy' ? (
            <>
              <div className="text-xs text-gray-500 mb-3">Deploy — dispatch #{selectedTask.dispatchId}</div>
              <DeployLogView projectId={selectedProjectId} dispatchId={selectedTask.dispatchId} />
            </>
          ) : (
            <p className="text-gray-600 text-sm italic pt-4">{selectedWorker.hostname} is idle.</p>
          )}
        </div>
      </div>
    </>
  );
}
