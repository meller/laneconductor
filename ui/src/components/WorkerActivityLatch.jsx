import React, { useState, useEffect, useRef } from 'react';
import { TranscriptView } from './TranscriptView.jsx';
import { DeployLogView } from './DeployLogView.jsx';
import { CreateProjectDispatchView } from './CreateProjectDispatchView.jsx';
import { TrackChatComposer } from './TrackChatComposer.jsx';
import { useTrackTranscript } from '../lib/useTrackTranscript.js';
import { parseWorkerTask, resolveWorkerChatTarget } from '../lib/workerTaskInfo.js';
import { isWorkerOffline } from '../lib/workerStatus.js';

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
//
// Track 10037 Phase 4 Task 2: the bottom chat bar used to dispatch a
// worker_adhoc_chat/track_chat prompt (Phase 8, polled via worker_dispatch)
// — a second worker-mailbox channel outside the track conversation model.
// Replaced with the same TrackChatComposer/useTrackTranscript pieces
// WorkerChatPanel (10037 Phase 3) uses: messages post through the track's
// own conversation (POST .../comments), and resolveWorkerChatTarget picks
// the running track if busy, else the worker's last-context track (warm
// session, cheap to resume) — same "one surface to watch and talk to a
// worker" as the strip's WorkerChatPanel.


export function WorkerActivityLatch({ workers, projectId, onClose, onSelectTrack }) {
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const transcriptEndRef = useRef(null);

  const selectedWorker = workers.find(w => w.id === selectedWorkerId) ?? null;
  const selectedTask = parseWorkerTask(selectedWorker?.current_task);
  // /api/workers (all-projects) returns project_id per worker; the
  // per-project /api/projects/:id/workers doesn't need to (it's already
  // scoped) — fall back to the currently selected project in that case.
  const selectedProjectId = selectedWorker?.project_id ?? projectId;

  // Track 10037: what track a chat with this worker is about — running
  // track if busy, else the last-context track (REQ-3/REQ-5), null for
  // managers or a worker with neither (REQ-7).
  const chatTarget = resolveWorkerChatTarget(selectedWorker, selectedProjectId);
  const isManager = selectedWorker?.type === 'manager';

  const showTrackTranscript = selectedTask?.kind !== 'deploy' && selectedTask?.kind !== 'create-project' && !!chatTarget;
  const { blocks, rawLog } = useTrackTranscript(
    showTrackTranscript ? chatTarget.projectId : null,
    showTrackTranscript ? chatTarget.trackNumber : null,
  );
  const [localComments, setLocalComments] = useState([]);

  const handleSelectWorker = (workerId) => {
    setSelectedWorkerId(workerId);
    setLocalComments([]);
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks]);

  const formatWorkerName = (w) => {
    if (!w) return '';
    const explicitName = w.name || w.worker_name;
    if (explicitName) {
      return `${explicitName} (${w.hostname}${w.worker_number ? ` #${w.worker_number}` : ''})`;
    }
    const workerNum = w.worker_number ? ` #${w.worker_number}` : '';
    const project = w.type === 'manager' ? ' · MANAGER' : (w.project_name ? ` · ${w.project_name}` : '');
    return `${w.hostname}${workerNum}${project}`;
  };

  const workerDisplayName = formatWorkerName(selectedWorker);

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
                const wName = formatWorkerName(w);
                return (
                  <button
                    key={w.id}
                    onClick={() => handleSelectWorker(w.id)}
                    className={`w-full text-left px-4 py-2.5 border-b border-gray-900 text-xs transition-colors ${selectedWorkerId === w.id ? 'bg-gray-800' : 'hover:bg-gray-900'
                      }`}
                  >
                    <div className="flex items-center gap-1.5 justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${offline ? 'bg-gray-600' : w.status === 'busy' ? 'bg-orange-400' : 'bg-green-500'
                            }`}
                        />
                        <span className="font-medium text-gray-300 truncate">
                          {wName}
                        </span>
                      </div>
                      {w.type === 'manager' && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.2 rounded border bg-purple-900/50 text-purple-300 border-purple-700/60 shrink-0 ml-1" data-testid="manager-badge">
                          MANAGER
                        </span>
                      )}
                    </div>
                    <div className="text-gray-500 truncate mt-0.5 pl-3">
                      {offline
                        ? 'offline'
                        : task?.kind === 'track'
                          ? `#${task.trackNumber} — ${w.current_task}`
                          : task?.kind === 'deploy'
                            ? `🚀 ${w.current_task}`
                            : w.current_task
                              ? w.current_task
                              : w.last_track_number
                                ? `last: #${w.last_track_number}`
                                : 'idle'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Selected worker's live activity & interactive chat */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!selectedWorker ? (
              <p className="text-gray-600 text-sm italic pt-4">Select a worker to see its live activity.</p>
            ) : selectedTask?.kind === 'deploy' ? (
              <>
                <div className="text-xs text-gray-500 mb-3 font-mono">
                  {workerDisplayName} · Deploy — dispatch #{selectedTask.dispatchId}
                </div>
                <DeployLogView projectId={selectedProjectId} dispatchId={selectedTask.dispatchId} />
              </>
            ) : showTrackTranscript ? (
              <>
                <div className="text-xs text-gray-500 mb-3 font-mono">
                  {workerDisplayName} ·{' '}
                  {onSelectTrack ? (
                    <button
                      onClick={() => onSelectTrack(chatTarget.projectId, chatTarget.trackNumber)}
                      className="text-blue-400 hover:text-blue-300 hover:underline"
                      title="Open this track"
                      data-testid="worker-latch-track-link"
                    >
                      Track #{chatTarget.trackNumber} {chatTarget.source === 'last' ? '(last session)' : ''} ↗
                    </button>
                  ) : (
                    <>Track #{chatTarget.trackNumber}</>
                  )}
                </div>
                {blocks.length > 0 ? (
                  <TranscriptView blocks={blocks} />
                ) : rawLog ? (
                  <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-gray-800 text-gray-300 whitespace-pre-wrap max-h-[500px] overflow-y-auto">
                    {rawLog}
                  </pre>
                ) : (
                  <p className="text-gray-600 text-sm italic pt-4">No transcript yet.</p>
                )}
                <div ref={transcriptEndRef} />
              </>
            ) : (
              <p className="text-gray-600 text-sm italic pt-4">{workerDisplayName} is idle.</p>
            )}

            {/* Track 10037: locally-echoed outgoing chat messages. */}
            {localComments.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-gray-800 pt-4">
                {localComments.map(c => (
                  <div key={c.id} className="text-xs text-blue-300 bg-blue-950/30 border border-blue-900/40 rounded-lg px-3 py-2">
                    {c.body}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Track 10037 Phase 4 Task 2: chat composer, same piece WorkerChatPanel uses. */}
          {selectedWorker && (
            <TrackChatComposer
              projectId={chatTarget?.projectId}
              trackNumber={chatTarget?.trackNumber}
              disabled={isManager || !chatTarget || isWorkerOffline(selectedWorker)}
              disabledHint={
                isManager
                  ? 'Managers are transcript-only'
                  : isWorkerOffline(selectedWorker)
                    ? `${workerDisplayName} is offline`
                    : 'No track to talk about — this worker has no running or last-context track'
              }
              placeholder={chatTarget ? `Send a message about track #${chatTarget.trackNumber}…` : undefined}
              onSent={(comment) => setLocalComments(prev => [...prev, comment])}
            />
          )}
        </div>
      </div>
    </>
  );
}
