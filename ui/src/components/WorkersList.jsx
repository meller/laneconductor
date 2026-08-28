import { useState, useEffect } from 'react';
import { WorkerVisibilityDialog } from './WorkerVisibilityDialog.jsx';
import { ProvisionWorkerModal } from './ProvisionWorkerModal.jsx';
import { WorkerModelModal, MODEL_PRESETS, CLI_ENGINES } from './WorkerModelModal.jsx';
import { WorkerChatPanel } from './WorkerChatPanel.jsx';
import { useApi } from '../hooks/useApi.js';
import { parseWorkerTask } from '../lib/workerTaskInfo.js';
import { sortWorkersForStrip } from '../lib/workerSort.js';
import { providerIcon, defaultModelFor } from '../../../conductor/providers.mjs';
import { getDefaultProviderModel } from '../lib/defaultModel.js';

// Start/stop actions shell out to `make lc-start`/`lc-stop` on whatever
// machine the API server is running on (see ui/server/index.mjs's
// worker/start,stop handlers) — there's no SSH-backed remote start yet
// (that's track 1089), so on a real deployment these buttons would run on
// the API's own container, not the user's machine. Only safe to offer on
// localhost, where the API and the worker's target machine are the same.
const IS_LOCAL_HOST = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const VISIBILITY_BADGE = {
  private: { label: 'Private', icon: '🔒', className: 'text-gray-500 border-gray-800' },
  team: { label: 'Team', icon: '👥', className: 'text-blue-400 border-blue-900/50' },
  public: { label: 'Public', icon: '🌐', className: 'text-green-400 border-green-900/50' },
};

// Neutral fallback text shown when a worker hasn't reported its `model`
// yet AND its `cli` isn't a recognized provider (never a hardcoded
// Claude model id for a non-Claude worker — see track 10011).
function workerModelLabel(worker) {
  return worker.model || defaultModelFor(worker.cli) || 'model not reported yet';
}

// Track 10037 REQ-2: current_task is "<lane action> track <NNN>" (see
// updateWorkerHeartbeat call sites in laneconductor.sync.mjs) — the chip
// wants both halves, not just the raw string parseWorkerTask already
// reduces to a bare track number.
function laneActionLabel(currentTask) {
  if (!currentTask) return '';
  return currentTask.replace(/\s+track\s+\S+$/, '').trim();
}

function ProviderStatus({ providers }) {
  if (!providers || providers.length === 0) return null;

  return (
    <div className="flex items-center gap-3 ml-3 border-l border-gray-800 pl-3">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
        LLM Status:
      </div>
      {providers.map(p => {
        const isExhausted = p.status === 'exhausted';
        const resetTime = p.reset_at ? new Date(p.reset_at) : null;
        const now = new Date();
        const diffSecs = resetTime ? Math.max(0, Math.floor((resetTime - now) / 1000)) : 0;

        // If reset time is in the past, it's actually available but DB hasn't updated yet
        const effectivelyExhausted = isExhausted && diffSecs > 0;

        const waitFmt = diffSecs > 3600
          ? `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`
          : diffSecs > 60
            ? `${Math.floor(diffSecs / 60)}m`
            : `${diffSecs}s`;

        return (
          <div key={p.provider} className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded px-2 py-0.5 whitespace-nowrap" title={p.last_error}>
            <div className={`w-1.5 h-1.5 rounded-full ${effectivelyExhausted ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
            <span className="text-[11px] font-medium text-gray-300 capitalize">{p.provider}</span>
            {effectivelyExhausted && (
              <span className="text-[10px] text-red-400 border-l border-gray-700 pl-2">
                Exhausted (resets in {waitFmt})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WaitingQueue({ tracks, onPriorityChange }) {
  if (!tracks || tracks.length === 0) return (
    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
      <span className="text-2xl mb-2 opacity-20">📭</span>
      <p className="text-gray-600 text-xs italic">Queue is empty — no tracks waiting</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {tracks.map(track => (
        <div key={`${track.project_id}-${track.track_number}`} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg p-3 group hover:border-gray-700 transition-colors">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight">{track.project_name}</span>
              <span className="text-xs font-bold text-gray-300">#{track.track_number}</span>
            </div>
            <p className="text-sm text-gray-200 font-medium truncate max-w-[300px]">{track.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-500 uppercase font-bold tracking-widest">
                {track.lane_status}
              </span>
              <span className="text-[10px] text-gray-600">
                Added {new Date(track.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[9px] text-gray-600 uppercase font-bold tracking-widest">Priority</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPriorityChange(track, (track.priority || 0) - 1)}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-800 text-gray-500 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 transition-colors"
                >
                  -
                </button>
                <span className={`text-xs font-mono font-bold w-6 text-center ${track.priority > 0 ? 'text-blue-400' : track.priority < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {track.priority || 0}
                </span>
                <button
                  onClick={() => onPriorityChange(track, (track.priority || 0) + 1)}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-800 text-gray-500 hover:text-green-400 hover:border-green-900/50 hover:bg-green-950/20 transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkersList({ projectId, project, workers, providers = [], waitingTracks = [], layout = 'strip', onRefresh, onSelectTrack }) {
  const { apiFetch } = useApi();
  const hasWorkers = workers && workers.length > 0;
  // REQ-3b: 'claude' was previously hardcoded here as the "cli not
  // reported" fallback — resolve it from the project's actual configured
  // default (falling back through live discovery / registry recommendation)
  // instead, same as every other former hardcoded-claude site.
  const defaultCli = getDefaultProviderModel(project, workers).cli;
  // Track 1084 Phase 6: "does this project have a worker of its own?" is a
  // different question from "what workers are visible here". A manager is
  // deliberately included in a project's worker list (the provisioning and
  // New Project flows need to find it), but it belongs to no project — so
  // counting it made a project with zero real workers look staffed, and
  // the empty-state "Start Sync Worker" button never rendered for ANY
  // project as long as a manager was running anywhere.
  const hasOwnWorkers = (workers || []).some(w => w.type !== 'manager');
  const [visibilityWorker, setVisibilityWorker] = useState(null);
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [configWorker, setConfigWorker] = useState(null);
  // Track 10037 Phase 3/4: which worker's chat panel is open, and whether
  // it's pinned to a specific track (last-track chip) or should resolve
  // via the default running > last priority (general chat trigger).
  const [chatTarget, setChatTarget] = useState(null);
  const openChat = (worker, forcedTrackNumber) => setChatTarget({ worker, forcedTrackNumber });
  // Track 1096 Phase 7: picker state for the "Start Sync Worker" button —
  // this project's own worker #1, started locally, so (unlike
  // ProvisionWorkerModal) there's no project/machine choice, just CLI/model.
  const [startCli, setStartCli] = useState('claude');
  const [startModel, setStartModel] = useState(MODEL_PRESETS.claude[0].id);
  const startModelOptions = MODEL_PRESETS[startCli] || [];

  useEffect(() => {
    if (startModelOptions.length && !startModelOptions.some(m => m.id === startModel)) {
      setStartModel(startModelOptions[0].id);
    }
  }, [startCli, startModelOptions, startModel]);

  async function handleStopWorker(worker) {
    try {
      const res = await apiFetch(`/api/workers/${worker.id}/stop`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      onRefresh?.();
    } catch (err) {
      console.error('Failed to stop worker:', err);
      alert(`Failed to stop worker: ${err.message}`);
    }
  }

  async function handleWorkerAction(action, body) {
    if (!projectId) return;
    try {
      const res = await apiFetch(`/api/projects/${projectId}/worker/${action}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      console.log(`Worker ${action} result:`, data);
      onRefresh?.();
    } catch (err) {
      console.error(`Failed to ${action} worker:`, err);
      alert(`Failed to ${action} worker: ${err.message}`);
    }
  }

  async function handlePriorityChange(track, newPriority) {
    try {
      await apiFetch(`/api/projects/${track.project_id}/tracks/${track.track_number}/priority`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: newPriority }),
      });
      // Global refresh via WS should trigger, but we could also locally update if needed
    } catch (err) {
      console.error('Failed to update priority:', err);
    }
  }

  if (layout === 'grid') {
    // For now we don't show providers in grid layout as it's less common, or we could add them at the top
    // hasOwnWorkers, not hasWorkers — a manager visible here doesn't mean
    // this project is staffed. See the note at its definition.
    if (!hasOwnWorkers) {
      return (
        <>
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-6">
            <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 shadow-inner">
              <span className="text-2xl opacity-50">🤖</span>
            </div>
            <h3 className="text-gray-300 font-medium mb-1">No Active Workers</h3>
            <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
              There are no heartbeat workers currently registered for this project.
            </p>
            <div className="mt-6 flex flex-col items-center gap-4">
              <div className="p-3 bg-gray-900/50 border border-gray-800 rounded-lg text-left w-full max-w-xs">
                <p className="text-[11px] text-gray-500 uppercase tracking-widest font-bold mb-2">How to start a worker:</p>
                <code className="text-xs text-blue-400 block font-mono">
                  $ make lc-start
                </code>
              </div>

              <div className="flex items-center gap-3">
                {/* Project-scoped (`make lc-start` in this project's dir), so
                    it silently did nothing in the All Projects view. */}
                {IS_LOCAL_HOST && projectId && (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={startCli}
                      onChange={e => setStartCli(e.target.value)}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
                      data-testid="start-worker-cli-select"
                      title="CLI engine for this worker"
                    >
                      {CLI_ENGINES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                    <select
                      value={startModel}
                      onChange={e => setStartModel(e.target.value)}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
                      data-testid="start-worker-model-select"
                      title="Model for this worker"
                    >
                      {startModelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <button
                      onClick={() => handleWorkerAction('start', { cli: startCli, model: startModel })}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
                    >
                      Start Sync Worker
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setShowProvisionModal(true)}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm shadow-lg shadow-purple-900/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <span>+ New Worker</span>
                </button>
              </div>
            </div>
          </div>
          {showProvisionModal && (
            <ProvisionWorkerModal
              projectId={projectId}
              workers={workers}
              onClose={() => setShowProvisionModal(false)}
              onProvisioned={onRefresh}
            />
          )}
        </>
      );
    }
    return (
      <>
        <div className="flex flex-col gap-8">
          {/* LLM Providers Section */}
          {providers && providers.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">LLM Providers</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {providers.map(p => {
                  const isExhausted = p.status === 'exhausted';
                  const resetTime = p.reset_at ? new Date(p.reset_at) : null;
                  const now = new Date();
                  const diffSecs = resetTime ? Math.max(0, Math.floor((resetTime - now) / 1000)) : 0;
                  const effectivelyExhausted = isExhausted && diffSecs > 0;

                  const waitFmt = diffSecs > 3600
                    ? `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`
                    : diffSecs > 60
                      ? `${Math.floor(diffSecs / 60)}m`
                      : `${diffSecs}s`;

                  return (
                    <div
                      key={p.provider}
                      className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm group ${effectivelyExhausted ? 'border-red-900/50 bg-red-950/5' : 'border-gray-800'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${effectivelyExhausted ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                          <span className="font-semibold text-gray-200 capitalize">{p.provider}</span>
                        </div>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${effectivelyExhausted ? 'text-red-400 border-red-900/50 bg-red-900/10' : 'text-gray-500 border-gray-800 bg-black/30'
                          }`}>
                          {effectivelyExhausted ? 'EXHAUSTED' : 'HEALTHY'}
                        </span>
                      </div>

                      <div className="flex-1 min-h-[3rem]">
                        {effectivelyExhausted ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-red-500/70 uppercase font-bold tracking-tight">Cooldown Active</span>
                            <p className="text-xs text-red-200/80 leading-relaxed bg-red-900/10 p-2 rounded border border-red-900/20 font-mono">
                              Resets in {waitFmt}
                            </p>
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center border border-dashed border-gray-800 rounded-lg">
                            <span className="text-[11px] text-gray-600 italic">Available for tasks</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-800/50">
                        <div className="flex flex-col">
                          <span className="text-[9px] text-gray-600 uppercase font-bold">Model Pool</span>
                          <span className="text-[11px] text-gray-400 capitalize">
                            {p.provider} API
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] text-gray-600 uppercase font-bold">Updated</span>
                          <span className="text-[11px] text-gray-400">
                            {new Date(p.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sync Workers Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pl-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Heartbeat Workers</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowProvisionModal(true)}
                  className="text-[10px] px-2.5 py-1 border border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40 rounded font-bold uppercase tracking-wider transition-colors flex items-center gap-1 shadow-sm"
                  data-testid="add-new-worker-btn"
                >
                  <span>+ New Worker</span>
                </button>
                {/* Project-scoped: shells out to `make lc-stop` in this
                    project's directory, so it can't reach a manager (which
                    lives elsewhere) — and it does nothing at all without a
                    project, which it used to do silently in the
                    All Projects view. Hidden there instead. */}
                {IS_LOCAL_HOST && projectId && (
                  <button
                    onClick={() => handleWorkerAction('stop')}
                    title="Stops this project's own workers. Managers are unaffected."
                    className="text-[10px] px-2 py-1 border border-red-900/50 text-red-400 hover:bg-red-900/20 rounded font-bold uppercase tracking-wider transition-colors"
                  >
                    Stop All Workers
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {workers.map(worker => {
                const vis = VISIBILITY_BADGE[worker.visibility || 'private'];
                return (
                  <div
                    key={worker.id}
                    className={`border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm group ${worker.status === 'busy' ? 'bg-amber-900/10 border-amber-800' : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                      }`}
                    data-testid="worker-card"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${worker.status === 'busy' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-200">{worker.hostname}</span>
                            {worker.type === 'manager' ? (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shadow-sm bg-purple-600/30 text-purple-300 border-purple-500/60" data-testid="manager-badge">
                                👑 MANAGER
                              </span>
                            ) : worker.mode ? (
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shadow-sm ${worker.mode === 'sync-only'
                                  ? 'bg-blue-600/20 text-blue-400 border-blue-500/50'
                                  : 'bg-purple-600/20 text-purple-400 border-purple-500/50'
                                  }`}
                                title={worker.mode === 'sync-only'
                                  ? 'Manual — syncs and serves dispatched actions, does not auto-claim the queue'
                                  : 'Automatic — also claims and runs queued tracks on its own'}
                              >
                                {/* Track 1103 D6: user-facing label is Manual/Automatic — the
                                    internal wire value (worker.mode, DB column, CLI flags) stays
                                    sync-only/sync+poll unchanged, this is display-only. Renamed
                                    because the mechanism names caused a real misdiagnosis
                                    earlier (1102 F1): a sync-only worker was reported as
                                    "broken" when it was working exactly as designed. */}
                                {worker.mode === 'sync-only' ? 'MANUAL' : 'AUTOMATIC'}
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-gray-600/20 text-gray-500 border-gray-500/50">
                                UNKNOWN MODE
                              </span>
                            )}
                          </div>
                          {worker.type === 'manager' ? (
                            <span className="text-[10px] font-mono text-purple-400 font-bold uppercase tracking-tight">
                              SYSTEM MANAGER
                            </span>
                          ) : worker.project_name ? (
                            <span className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight">
                              {worker.project_name}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setVisibilityWorker(worker)}
                          data-testid="worker-sharing-btn"
                          title={`Sharing: ${worker.visibility || 'private'}`}
                          className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider transition-colors hover:bg-gray-800 ${vis.className}`}
                        >
                          <span>{vis.icon}</span>
                          <span>{vis.label}</span>
                        </button>
                        <span className="text-[10px] font-mono text-gray-600 bg-black/30 px-1.5 py-0.5 rounded border border-gray-800">
                          PID: {worker.pid}
                        </span>
                        {/* Track 1084 Phase 6: stop THIS worker. Previously the
                            only control was the project-wide "Stop All Workers". */}
                        {IS_LOCAL_HOST && (
                          <button
                            onClick={() => handleStopWorker(worker)}
                            data-testid="worker-stop-btn"
                            title={worker.type === 'manager' ? 'Stop this manager worker' : `Stop worker #${worker.worker_number ?? 1}`}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-red-900/50 text-red-400 hover:bg-red-900/20 font-bold uppercase tracking-wider transition-colors"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-h-[3rem] flex flex-col gap-2">
                      {worker.current_task ? (
                        <div className="flex flex-col gap-1">
                          <span className={`text-[10px] uppercase font-bold tracking-tight ${worker.status === 'busy' ? 'text-amber-500' : 'text-gray-500'}`}>
                            Current Task
                          </span>
                          {(() => {
                            const task = parseWorkerTask(worker.current_task);
                            const trackNumber = task?.kind === 'track' ? task.trackNumber : null;
                            const badgeClass = `text-xs leading-relaxed p-2 rounded border font-medium ${worker.status === 'busy'
                              ? 'bg-amber-950/40 text-amber-300 border-amber-800/80 shadow-[0_0_10px_rgba(217,119,6,0.1)]'
                              : 'bg-gray-950/50 text-gray-300 border-gray-800/50'
                              }`;
                            // Track 1112 dogfood incident (2026-08-13): the
                            // user asked for exactly this — from the
                            // Workers view, clicking a worker's current
                            // task should jump straight to that track,
                            // instead of having to go find it on the board.
                            return trackNumber && onSelectTrack ? (
                              <button
                                onClick={() => onSelectTrack(worker.project_id ?? projectId, trackNumber)}
                                className={`${badgeClass} text-left hover:brightness-110 transition-all cursor-pointer`}
                                title="Open this track"
                                data-testid="worker-running-track-chip"
                              >
                                ▶ #{trackNumber} · {laneActionLabel(worker.current_task)} ↗
                              </button>
                            ) : (
                              <p className={badgeClass}>{worker.current_task}</p>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center border border-dashed border-gray-800 rounded-lg">
                          <span className="text-[11px] text-gray-600 italic">Idle — waiting for task</span>
                        </div>
                      )}
                      {/* Track 10037 REQ-3: last-context track chip — the
                          worker holds a warm session for this track even
                          when it isn't the one currently running. */}
                      {(() => {
                        const runningTask = parseWorkerTask(worker.current_task);
                        const runningTrackNumber = runningTask?.kind === 'track' ? runningTask.trackNumber : null;
                        if (!worker.last_track_number || worker.last_track_number === runningTrackNumber) return null;
                        return (
                          <button
                            onClick={() => openChat(worker, worker.last_track_number)}
                            className="self-start flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-gray-700 bg-gray-950/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                            title="This worker still has session context for this track — talking about it is cheap."
                            data-testid="worker-last-track-chip"
                          >
                            last: #{worker.last_track_number}
                          </button>
                        );
                      })()}
                    </div>
                    <div className="flex items-center justify-between bg-gray-950/60 px-2 py-1.5 rounded-lg border border-gray-800/80 my-2">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="text-xs">{providerIcon(worker.cli)}</span>
                        <span className="text-[11px] font-medium text-gray-300 capitalize">{worker.cli || defaultCli}</span>
                        <span className="text-[10px] font-mono text-purple-400 bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-800/40 truncate" data-testid="worker-model-badge">
                          {workerModelLabel(worker)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {worker.type !== 'manager' && (
                          <button
                            onClick={() => openChat(worker)}
                            className="text-[10px] px-2 py-0.5 border border-blue-800/60 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40 rounded font-bold transition-colors"
                            data-testid="worker-chat-btn"
                            title="Chat with this worker"
                          >
                            💬 Chat
                          </button>
                        )}
                        <button
                          onClick={() => setConfigWorker(worker)}
                          className="text-[10px] px-2 py-0.5 border border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40 rounded font-bold transition-colors"
                          data-testid="change-worker-model-btn"
                        >
                          Change Model
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-800/50">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-gray-600 uppercase font-bold">Status</span>
                        <span className={`text-[11px] font-medium ${worker.status === 'busy' ? 'text-amber-400' : 'text-green-400'}`}>
                          {worker.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-gray-600 uppercase font-bold">Last Beat</span>
                        <span className="text-[11px] text-gray-400">
                          {new Date(worker.last_heartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Waiting Queue Section (REQ-9, REQ-10) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pl-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                Waiting Queue
                {waitingTracks.length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    {waitingTracks.length}
                  </span>
                )}
              </h3>
              <span className="text-[10px] text-gray-600 italic">Sorted by priority, then creation date</span>
            </div>
            <WaitingQueue
              tracks={waitingTracks}
              onPriorityChange={handlePriorityChange}
            />
          </div>
        </div>

        {visibilityWorker && (
          <WorkerVisibilityDialog
            worker={visibilityWorker}
            onClose={() => setVisibilityWorker(null)}
            onUpdated={() => { onRefresh?.(); setVisibilityWorker(null); }}
          />
        )}
        {showProvisionModal && (
          <ProvisionWorkerModal
            projectId={projectId}
            workers={workers}
            onClose={() => setShowProvisionModal(false)}
            onProvisioned={onRefresh}
          />
        )}
        {configWorker && (
          <WorkerModelModal
            worker={configWorker}
            project={project}
            workers={workers}
            onClose={() => setConfigWorker(null)}
            onUpdated={() => {
              onRefresh?.();
              setConfigWorker(null);
            }}
          />
        )}
        {chatTarget && (
          <WorkerChatPanel
            worker={chatTarget.worker}
            projectId={chatTarget.worker.project_id ?? projectId}
            forcedTrackNumber={chatTarget.forcedTrackNumber}
            onClose={() => setChatTarget(null)}
            onSelectTrack={onSelectTrack}
          />
        )}
      </>
    );
  }

  // Default 'strip' layout
  return (
    <div className="flex items-center bg-gray-900/50 border-b border-gray-800 overflow-x-auto no-scrollbar py-0.5">
      <div className="flex items-center gap-3 px-4 border-r border-gray-800 min-h-[28px]">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
          Workers:
        </div>
        {/* Track 1103 D1/D2: hasOwnWorkers, not hasWorkers — this used
            hasWorkers, which stayed true whenever a manager was visible
            (nearly always, since managers appear in every project's
            worker list for provisioning), so this indicator was silently
            hidden for every project with zero of its OWN workers. Also
            strengthened from small gray italic text — easy to miss on
            the exact board a user is staring at while nothing happens —
            to an explicit, actionable badge. Not a blocking modal (D1:
            zero workers is a valid state), just no longer silent (D2). */}
        {!hasOwnWorkers && (
          <span
            className="text-[10px] font-bold text-amber-400 bg-amber-900/20 border border-amber-800/50 rounded px-2 py-0.5"
            title="No workers registered for this project — lane actions triggered from the board will queue but nothing will run them."
          >
            ⚠ No worker for this project
          </span>
        )}
        {/* Track 10037 REQ-1: active-first ordering — busy workers (or ones
            with a task already in flight) can't be scrolled out of view by
            idle ones. */}
        {sortWorkersForStrip(workers).map(worker => (
          <div
            key={worker.id}
            data-testid="worker-strip-item"
            className={`flex items-center gap-2 bg-gray-950 border rounded px-2 py-0.5 whitespace-nowrap transition-colors ${worker.status === 'busy' ? 'border-amber-700/50 bg-amber-900/10' : 'border-gray-800'
              }`}
            title={`PID: ${worker.pid} | Last beat: ${new Date(worker.last_heartbeat).toLocaleTimeString()}`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${worker.status === 'busy' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
            <span className={`text-[11px] font-medium transition-colors ${worker.status === 'busy' ? 'text-amber-200' : 'text-gray-300'}`}>
              {worker.hostname}
            </span>
            {worker.type === 'manager' ? (
              <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border bg-purple-900/50 text-purple-300 border-purple-700/60" data-testid="manager-badge">
                👑 MANAGER
              </span>
            ) : worker.mode ? (
              <span
                className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${worker.mode === 'sync-only'
                  ? 'bg-blue-900/40 text-blue-400 border-blue-800/50'
                  : 'bg-purple-900/40 text-purple-400 border-purple-800/50'
                  }`}
                title={worker.mode === 'sync-only'
                  ? 'Manual — syncs and serves dispatched actions, does not auto-claim the queue'
                  : 'Automatic — also claims and runs queued tracks on its own'}
              >
                {/* Track 1103 D6: see the grid layout's identical badge above for the full note. */}
                {worker.mode === 'sync-only' ? 'MANUAL' : 'AUTOMATIC'}
              </span>
            ) : (
              <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border bg-gray-600/20 text-gray-500 border-gray-500/50">
                UNKNOWN
              </span>
            )}
            {worker.type === 'manager' ? (
              <span className="text-[9px] font-mono text-purple-400 font-bold uppercase tracking-tight border-l border-gray-800 pl-2">
                MANAGER
              </span>
            ) : worker.project_name ? (
              <span className="text-[9px] font-mono text-blue-500 font-bold uppercase tracking-tight border-l border-gray-800 pl-2">
                {worker.project_name}
              </span>
            ) : null}
            {/* Track 10037 REQ-2: promoted running-track chip — track
                number + lane action, not just the raw current_task text. */}
            {worker.current_task && (() => {
              const task = parseWorkerTask(worker.current_task);
              const trackNumber = task?.kind === 'track' ? task.trackNumber : null;
              const spanClass = `text-[10px] border-l pl-2 max-w-[200px] truncate transition-colors ${worker.status === 'busy' ? 'text-amber-400/80 border-amber-800/50' : 'text-gray-500 border-gray-800'
                }`;
              return trackNumber && onSelectTrack ? (
                <button
                  onClick={() => onSelectTrack(worker.project_id ?? projectId, trackNumber)}
                  className={`${spanClass} hover:brightness-125 cursor-pointer font-medium`}
                  title="Open this track"
                  data-testid="worker-running-track-chip"
                >
                  ▶ #{trackNumber} · {laneActionLabel(worker.current_task)} ↗
                </button>
              ) : (
                <span className={spanClass}>{worker.current_task}</span>
              );
            })()}
            {/* Track 10037 REQ-3: last-context track chip. */}
            {(() => {
              const runningTask = parseWorkerTask(worker.current_task);
              const runningTrackNumber = runningTask?.kind === 'track' ? runningTask.trackNumber : null;
              if (!worker.last_track_number || worker.last_track_number === runningTrackNumber) return null;
              return (
                <button
                  onClick={() => openChat(worker, worker.last_track_number)}
                  className="text-[10px] border-l border-gray-800 pl-2 text-gray-500 hover:text-gray-300 transition-colors"
                  title="This worker still has session context for this track — talking about it is cheap."
                  data-testid="worker-last-track-chip"
                >
                  last: #{worker.last_track_number}
                </button>
              );
            })()}
            {/* Track 10037 REQ-5: open the chat panel, defaulting to
                running > last priority via resolveWorkerChatTarget. */}
            {worker.type !== 'manager' && (
              <button
                onClick={() => openChat(worker)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-800/50 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40 transition-colors ml-1"
                data-testid="worker-chat-btn-strip"
                title="Chat with this worker"
              >
                💬
              </button>
            )}
            <button
              onClick={() => setConfigWorker(worker)}
              className="text-[10px] font-mono text-purple-300 bg-purple-950/40 hover:bg-purple-900/40 px-1.5 py-0.5 rounded border border-purple-800/50 transition-colors flex items-center gap-1 ml-2"
              data-testid="change-worker-model-btn-strip"
              title="Click to change model"
            >
              <span>{providerIcon(worker.cli)}</span>
              <span>{workerModelLabel(worker)}</span>
            </button>
          </div>
        ))}
      </div>

      {waitingTracks.length > 0 && (
        <div className="flex items-center gap-2 px-4 border-r border-gray-800 min-h-[28px]" title="Tracks in waiting queue">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
            Queue:
          </div>
          <span className="bg-blue-900/50 text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded border border-blue-800/50">
            {waitingTracks.length} tracks
          </span>
        </div>
      )}

      <ProviderStatus providers={providers} />

      {visibilityWorker && (
        <WorkerVisibilityDialog
          worker={visibilityWorker}
          onClose={() => setVisibilityWorker(null)}
          onUpdated={() => { onRefresh?.(); setVisibilityWorker(null); }}
        />
      )}

      {showProvisionModal && (
        <ProvisionWorkerModal
          projectId={projectId}
          workers={workers}
          onClose={() => setShowProvisionModal(false)}
          onProvisioned={onRefresh}
        />
      )}

      {configWorker && (
        <WorkerModelModal
          worker={configWorker}
          project={project}
          workers={workers}
          onClose={() => setConfigWorker(null)}
          onUpdated={() => {
            onRefresh?.();
            setConfigWorker(null);
          }}
        />
      )}

      {chatTarget && (
        <WorkerChatPanel
          worker={chatTarget.worker}
          projectId={chatTarget.worker.project_id ?? projectId}
          forcedTrackNumber={chatTarget.forcedTrackNumber}
          onClose={() => setChatTarget(null)}
          onSelectTrack={onSelectTrack}
        />
      )}
    </div>
  );
}
